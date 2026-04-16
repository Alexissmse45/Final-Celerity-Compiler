import math
from code_gen import (
    TACFuncBegin, TACFuncEnd, TACDeclare, TACArrayDeclare,
    TACAssign, TACBinOp, TACUnary, TACLabel, TACGoto, TACIfFalse,
    TACPrint, TACReturn, TACCall, TACStructDef,
)


def count_inputs(tac_list):
    READ_FNS = {"read_int","read_double","read_char","read_word","read_bool"}
    return sum(1 for i in tac_list if isinstance(i, TACCall) and i.func in READ_FNS)


def get_input_types(tac_list):
    READ_TYPE = {"read_int":"num","read_double":"deci","read_char":"single",
                 "read_word":"word","read_bool":"bool"}
    return [READ_TYPE.get(i.func,"word") for i in tac_list
            if isinstance(i, TACCall) and i.func in READ_TYPE]


class TACInterpreter:
    MAX_ITER = 200_000

    def __init__(self):
        self.output_lines = []
        self.events       = []
        self._iter        = 0
        self._input_queue = []
        self._input_types = []
        self._input_index = 0
        self._buf         = ""
        self._scan_mode   = False

    def run(self, tac_list, user_inputs=None):
        self.output_lines = []
        self.events       = []
        self._iter        = 0
        self._input_queue = list(user_inputs or [])
        self._input_types = get_input_types(tac_list)
        self._input_index = 0
        self._buf         = ""
        self._scan_mode   = len(self._input_queue) == 0

        label_map = {ins.name: i for i, ins in enumerate(tac_list)
                     if isinstance(ins, TACLabel)}
        func_map  = {ins.name: i for i, ins in enumerate(tac_list)
                     if isinstance(ins, TACFuncBegin)}
        main_start = next((i+1 for i, ins in enumerate(tac_list)
                           if isinstance(ins, TACFuncBegin) and ins.name == "main"), None)
        if main_start is None:
            return "(no main found)", []

        env = {}
        try:
            self._exec(tac_list, main_start, env, label_map, func_map, 0)
        except (_ProgramDone, _ReturnSignal):
            pass
        except _ScanStop:
            pass
        except _IterLimit:
            self._out("[stopped: iteration limit]")
        except Exception as e:
            self._flush_buf()
            self.events.append({"type": "runtime_error", "text": str(e)})

        self._flush_buf()
        plain = "\n".join(self.output_lines) if self.output_lines else "(no output)"
        return plain, self.events

    # ── helpers ───────────────────────────────────────────────────────────────

    def _out(self, text):
        combined = self._buf + text
        self._buf = ""
        self.output_lines.append(combined)
        self.events.append({"type": "output", "text": combined})

    def _flush_buf(self):
        if self._buf:
            self.output_lines.append(self._buf)
            self.events.append({"type": "output", "text": self._buf})
            self._buf = ""

    def _absorb_prompt(self):
        if self._buf:
            prompt = self._buf
            self._buf = ""
            return prompt
        if self.events and self.events[-1]["type"] == "output":
            text = self.events[-1]["text"]
            self.events.pop()
            if self.output_lines:
                self.output_lines.pop()
            return text
        return ""

    # ── executor ──────────────────────────────────────────────────────────────

    def _exec(self, tac, start, env, lmap, fmap, depth, skip_decl=None):
        """
        skip_decl: set of variable names bound by argument passing.
        TACDeclare / TACArrayDeclare for these names are skipped so
        passed values are not overwritten by default initialisers.
        """
        if depth > 200: raise RecursionError("call depth exceeded")
        _skip = skip_decl or set()
        pc = start
        while pc < len(tac):
            self._iter += 1
            if self._iter > self.MAX_ITER: raise _IterLimit()

            ins = tac[pc]

            if isinstance(ins, TACFuncEnd):   return
            if isinstance(ins, (TACStructDef, TACFuncBegin)): pc+=1; continue

            if isinstance(ins, TACDeclare):
                if ins.name not in _skip:
                    env[ins.name] = self._ev(ins.init, env) if ins.init is not None else self._zero(ins.c_type)
                pc+=1; continue

            if isinstance(ins, TACArrayDeclare):
                if ins.name not in _skip:
                    if ins.init:
                        if isinstance(ins.init[0], list):
                            env[ins.name] = [[self._ev(v,env) for v in row] for row in ins.init]
                        else:
                            env[ins.name] = [self._ev(v,env) for v in ins.init]
                    else:
                        env[ins.name] = []
                pc+=1; continue

            if isinstance(ins, TACAssign):
                if "[" in ins.result: self._astore(ins.result, self._ev(ins.operand,env), env)
                else: env[ins.result] = self._ev(ins.operand, env)
                pc+=1; continue

            if isinstance(ins, TACBinOp):
                env[ins.result] = self._binop(ins.op, self._ev(ins.left,env), self._ev(ins.right,env))
                pc+=1; continue

            if isinstance(ins, TACUnary):
                if ins.post:
                    cur = self._ev(ins.result, env)
                    env[ins.result] = cur + (1 if ins.op=="++" else -1)
                elif ins.op in ("++","--"):
                    cur = self._ev(ins.result, env)
                    env[ins.result] = cur + (1 if ins.op=="++" else -1)
                elif ins.op == "!":   env[ins.result] = not self._ev(ins.operand, env)
                elif ins.op == "-":   env[ins.result] = -self._ev(ins.operand, env)
                else:                 env[ins.result] = self._ev(ins.operand, env)
                pc+=1; continue

            if isinstance(ins, TACLabel): pc+=1; continue

            if isinstance(ins, TACGoto):
                t = lmap.get(ins.label); pc = (t+1) if t is not None else pc+1; continue

            if isinstance(ins, TACIfFalse):
                if not self._ev(ins.cond, env):
                    t = lmap.get(ins.label); pc = (t+1) if t is not None else pc+1
                else: pc+=1
                continue

            if isinstance(ins, TACPrint):
                self._print(ins, env)
                pc+=1; continue

            if isinstance(ins, TACReturn):
                raise _ReturnSignal(self._ev(ins.value,env) if ins.value else None)

            if isinstance(ins, TACCall):
                res = self._call(ins, tac, env, lmap, fmap, depth)
                if ins.result is not None: env[ins.result] = res if res is not None else 0
                pc+=1; continue

            pc+=1

    def _call(self, ins, tac, cenv, lmap, fmap, depth):
        func = ins.func
        args = [self._ev(a, cenv) for a in ins.args]

        if func in ("read_int","read_double","read_char","read_word","read_bool"):
            prompt = self._absorb_prompt()
            idx    = self._input_index
            itype  = self._input_types[idx] if idx < len(self._input_types) else "word"
            self._input_index += 1

            if self._scan_mode:
                self.events.append({
                    "type": "input_prompt", "text": prompt,
                    "userValue": "", "inputIndex": idx,
                    "inputType": itype, "inputError": None,
                })
                self.output_lines.append(f"{prompt}")
                raise _ScanStop()

            if not self._input_queue:
                self.events.append({
                    "type": "input_prompt", "text": prompt,
                    "userValue": "", "inputIndex": idx,
                    "inputType": itype, "inputError": None,
                })
                self.output_lines.append(f"{prompt}")
                raise _ScanStop()

            raw = self._input_queue.pop(0).strip()
            parsed_raw = ("-" + raw[1:]) if raw.startswith("~") else raw

            error_msg = None
            if raw != "":
                if func == "read_int":
                    try: int(float(parsed_raw))
                    except: error_msg = f"Invalid input '{raw}'. Expected a whole number (num)."
                    else:
                        if "." in parsed_raw:
                            error_msg = f"Invalid input '{raw}'. Expected a whole number (num)."
                elif func == "read_double":
                    try: float(parsed_raw)
                    except: error_msg = f"Invalid input '{raw}'. Expected a decimal number (deci)."
                elif func == "read_bool":
                    if raw.lower() not in ("true","false","1","0","yes","no","y","n"):
                        error_msg = f"Invalid input '{raw}'. Expected true or false (bool)."
                elif func == "read_char":
                    if len(raw) != 1:
                        error_msg = f"Invalid input '{raw}'. Expected a single character (single)."

            self.events.append({
                "type": "input_prompt", "text": prompt,
                "userValue": raw, "inputIndex": idx,
                "inputType": itype, "inputError": error_msg,
            })
            self.output_lines.append(f"{prompt}{raw}")

            if error_msg:
                self.events.append({
                    "type": "input_error", "text": error_msg, "inputIndex": idx,
                })

            if func == "read_int":
                try: return int(float(parsed_raw)) if parsed_raw else 0
                except: return 0
            if func == "read_double":
                try: return float(parsed_raw) if parsed_raw else 0.0
                except: return 0.0
            if func == "read_char":   return raw[0] if raw else " "
            if func == "read_word":   return raw
            if func == "read_bool":   return raw.lower() in ("true","1","yes","y")

        # ── built-in functions ────────────────────────────────────────────
        if func == "len":
            s = args[0] if args else ""
            if isinstance(s, str):
                return len(s)
            elif isinstance(s, list):
                return len(s)
            return 0

        if func in fmap:
            fb = tac[fmap[func]]
            param_names = {p.split()[-1] for p in fb.params}

            # Start with caller's env so globals are accessible inside the function
            lenv = dict(cenv)
            for p, v in zip(fb.params, args):
                lenv[p.split()[-1]] = v

            try:
                self._exec(tac, fmap[func]+1, lenv, lmap, fmap, depth+1,
                           skip_decl=param_names)
            except _ReturnSignal as r:
                cenv.update(lenv)
                return r.value

            # Write all changes back after normal completion
            cenv.update(lenv)
        return None

    def _print(self, ins, env):
        val = self._ev(ins.value, env)
        fmt = ins.fmt
        if fmt == "bool":  text = "true" if val else "false"
        elif fmt == "%d":
            try: text = str(int(val))
            except: text = str(val)
        elif fmt == "%f":
            try: text = f"{float(val):.6f}"
            except: text = str(val)
        elif fmt == "%c":  text = str(val)
        else:
            if isinstance(val, list):
                s = "".join(str(c) for c in val)
            else:
                s = str(val) if val is not None else ""
            text = s[1:-1] if len(s) >= 2 and s[0]=='"' and s[-1]=='"' else s

        if '\\n' in text or '\n' in text:
            parts = text.replace('\\n', '\n').split('\n')
            self._buf += parts[0]
            self._flush_buf()
            for part in parts[1:-1]:
                self._buf += part
                self._flush_buf()
            self._buf += parts[-1]
        else:
            self._buf += text

    def _ev(self, expr, env):
        if expr is None: return 0
        expr = str(expr).strip()
        try: return int(expr)
        except ValueError: pass
        try: return float(expr)
        except ValueError: pass
        if expr == "true":  return True
        if expr == "false": return False
        if expr.startswith('"') and expr.endswith('"'): return expr
        if expr.startswith("'") and expr.endswith("'") and len(expr)==3: return expr[1]
        if "[" in expr:
            base = expr[:expr.index("[")]
            rest = expr[expr.index("["):]
            indices = []
            while rest.startswith("["):
                c = rest.index("]")
                indices.append(int(self._ev(rest[1:c], env)))
                rest = rest[c+1:]
            obj = env.get(base, [])
            for i in indices:
                if isinstance(obj, list) and 0 <= i < len(obj):
                    obj = obj[i]
                elif isinstance(obj, str) and 0 <= i < len(obj):
                    obj = obj[i]
                else:
                    obj = 0
            return obj
        if "." in expr:
            p = expr.split(".", 1)
            obj = env.get(p[0], {})
            return obj.get(p[1], 0) if isinstance(obj, dict) else 0
        return env.get(expr, 0)

    def _zero(self, c_type):
        if c_type in ("int","bool"): return 0
        if c_type == "double":       return 0.0
        if c_type == "char":         return " "
        if c_type == "char*":        return ""
        return 0

    def _astore(self, lhs, val, env):
        base = lhs[:lhs.index("[")]
        rest = lhs[lhs.index("["):]
        indices = []
        while rest.startswith("["):
            c = rest.index("]")
            indices.append(int(self._ev(rest[1:c], env)))
            rest = rest[c+1:]
        obj = env.get(base, [])

        # strings are immutable in Python — convert to char list for mutation
        if isinstance(obj, str):
            obj = list(obj)

        if len(indices)==1:
            while len(obj)<=indices[0]: obj.append(0)
            obj[indices[0]] = val
        elif len(indices)==2:
            while len(obj)<=indices[0]: obj.append([])
            while len(obj[indices[0]])<=indices[1]: obj[indices[0]].append(0)
            obj[indices[0]][indices[1]] = val
        env[base] = obj

    def _binop(self, op, l, r):
        try:
            if op=="+":  return l+r
            if op=="-":  return l-r
            if op=="*":  return l*r
            if op=="/":  return 0 if r==0 else ((l//r) if isinstance(l,int) and isinstance(r,int) else l/r)
            if op=="%":  return l%r if r!=0 else 0
            if op=="**": return math.pow(l,r)
            if op=="==": return l==r
            if op=="!=": return l!=r
            if op=="<":  return l<r
            if op==">":  return l>r
            if op=="<=": return l<=r
            if op==">=": return l>=r
            if op=="&&": return bool(l) and bool(r)
            if op=="||": return bool(l) or bool(r)
        except: pass
        return 0


class _ReturnSignal(Exception):
    def __init__(self, v): self.value = v
class _IterLimit(Exception): pass
class _ProgramDone(Exception): pass
class _ScanStop(Exception): pass
