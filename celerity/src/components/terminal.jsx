import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const Terminal = ({
  output, errors, activeTab, setActiveTab,
  tacCode,
  programEvents,
  sourceCode,
}) => {
  const [events, setEvents]           = useState([]);
  const [inputValues, setInputValues] = useState({});
  const [inputErrors, setInputErrors] = useState({});
  const [submitted, setSubmitted]     = useState(false);
  const [running, setRunning]         = useState(false);
  const inputRefs                     = useRef({});
  const outputEndRef                  = useRef(null);

  useEffect(() => {
    if (programEvents && programEvents.length > 0) {
      setEvents(programEvents);
      setInputValues({});
      setInputErrors({});
      setSubmitted(false);
      setRunning(false);
      setTimeout(() => {
        const first = programEvents.find(e => e.type === 'input_prompt');
        if (first) inputRefs.current[first.inputIndex]?.focus();
      }, 80);
    } else {
      setEvents([]);
      setInputValues({});
      setInputErrors({});
      setSubmitted(false);
      setRunning(false);
    }
  }, [programEvents]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, running]);

  const inputPrompts = events.filter(e => e.type === 'input_prompt');
  const allFilled    = inputPrompts.length > 0
    && inputPrompts.every(e => (inputValues[e.inputIndex] ?? '').trim() !== '')
    && inputPrompts.every(e => !inputErrors[e.inputIndex]);

  const handleChange = (idx, val, itype) => {
    setInputValues(prev => ({ ...prev, [idx]: val }));
    let err = null;
    const v = val.replace(/^~/, '-');
    if (itype === 'num') {
      if (val.trim() !== '' && (isNaN(Number(v)) || val.trim().includes('.')))
        err = `Invalid input. Expected a whole number (num).`;
    } else if (itype === 'deci') {
      if (val.trim() !== '' && isNaN(parseFloat(v)))
        err = `Invalid input. Expected a decimal number (deci).`;
    } else if (itype === 'bool') {
      const b = val.trim().toLowerCase();
      if (val.trim() !== '' && !['true','false','1','0','yes','no','y','n'].includes(b))
        err = `Invalid input. Expected true or false (bool).`;
    } else if (itype === 'single') {
      if (val.trim().length > 1)
        err = `Invalid input. Expected a single character (single).`;
    }
    setInputErrors(prev => ({ ...prev, [idx]: err }));
  };

  const handleKeyDown = (e, idx) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = (inputValues[idx] ?? '').trim();
    if (val === '' || inputErrors[idx]) return; // block on empty or invalid input
    const pos = inputPrompts.findIndex(p => p.inputIndex === idx);
    if (pos < inputPrompts.length - 1) {
      // Move to next input only if current is filled
      inputRefs.current[inputPrompts[pos + 1].inputIndex]?.focus();
    } else if (allFilled) {
      // Last input filled — submit
      submitAll();
    }
  };

  const submitAll = async () => {
    if (running || submitted) return;
    setRunning(true);
    const ordered    = [...inputPrompts].sort((a, b) => a.inputIndex - b.inputIndex);
    const userInputs = ordered.map(p => (inputValues[p.inputIndex] ?? '').trim());
    try {
      const res  = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: sourceCode, userInputs })
      });
      const data = await res.json();
      if (data.events?.length) {
        setEvents(data.events);
        setSubmitted(true);
      } else {
        setEvents(prev => [...prev,
          { type: 'output', text: data.error ? `[error: ${data.error}]` : '[no output]' }
        ]);
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: 'output', text: `[connection error: ${err.message}]` }]);
    }
    setRunning(false);
  };

  const buildRows = () => {
    const rows = [];
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.type === 'input_prompt') {
        let promptText = ev.text;
        if (!promptText && rows.length > 0 && rows[rows.length - 1].type === 'output') {
          promptText = rows.pop().text;
        }
        rows.push({ type: 'input_prompt', promptText, ev });
        i++;
      } else if (ev.type === 'runtime_error') {
        rows.push({ type: 'runtime_error', text: ev.text });
        i++;
      } else {
        rows.push({ type: 'output', text: ev.text });
        i++;
      }
    }
    return rows;
  };

  const renderRow = (row, i) => {
    if (row.type === 'runtime_error') {
      return (
        <div key={i} style={{ marginTop: '8px', padding: '6px 10px',
          background: '#FFF0F0', border: '1px solid #DC3545', borderRadius: '4px' }}>
          <span style={{ fontWeight: 'bold', color: '#DC3545' }}>⚠️ Runtime Error: </span>
          <span style={{ color: '#DC3545' }}>{row.text}</span>
        </div>
      );
    }

    if (row.type === 'output') {
      const lines = row.text.split('\\n');
      return (
        <div key={i}>
          {lines.map((line, j) => (
            <div key={j} style={{ whiteSpace: 'pre', minHeight: '1em' }}>{line}</div>
          ))}
        </div>
      );
    }

    if (row.type === 'input_prompt') {
      const { promptText, ev } = row;
      const idx    = ev.inputIndex;
      const isDone = submitted || (ev.userValue !== '' && ev.userValue != null);
      const value  = isDone
        ? (ev.userValue || inputValues[idx] || '')
        : (inputValues[idx] ?? '');

      return (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'pre' }}>
          {promptText ? <span>{promptText}</span> : null}
          {isDone ? (
            <span style={{ color: '#8B5E3C', fontWeight: 'bold' }}>{value}</span>
          ) : (
            <input
              ref={el => inputRefs.current[idx] = el}
              type="text"
              value={value}
              onChange={e => handleChange(idx, e.target.value, ev.inputType)}
              onKeyDown={e => handleKeyDown(e, idx)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${inputErrors[idx] ? '#DC3545' : '#8B7355'}`,
                outline: 'none',
                fontFamily: 'Consolas, monospace',
                fontSize: '9pt',
                color: inputErrors[idx] ? '#DC3545' : '#8B5E3C',
                minWidth: '60px',
                width: `${Math.max(60, (value.length + 2) * 7.8)}px`,
                padding: 0,
              }}
            />
          )}
          {!isDone && inputErrors[idx] && (
            <div style={{ color: '#DC3545', fontSize: '8pt', paddingLeft: '2px', marginTop: '1px' }}>
              ⚠️ {inputErrors[idx]}
            </div>
          )}
          </div>
        </div>
      );
    }
    return null;
  };

  const TabBtn = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-5 py-2 border-2 border-[#8B7355] transition-colors ${
        activeTab === id
          ? 'bg-[#E8DCC8] text-[#333] hover:bg-[#D4C4B0] rounded-t'
          : 'bg-[#C8B5A0] text-[#333] border-b-0 rounded-t'
      }`}
    >{label}</button>
  );

  return (
    <div className="flex flex-col" style={{ height: '240px' }}>
      <div className="flex gap-1">
        <TabBtn id="terminal" label="Terminal"       />
        <TabBtn id="generate" label="Generated Code" />
        <TabBtn id="tac"      label="TAC"            />
      </div>

      <div
        className="flex-1 bg-[#E8DCC8] border-2 border-[#8B7355] text-[#333] overflow-hidden flex flex-col"
        style={{ fontFamily: 'Consolas, monospace', fontSize: '9pt' }}
      >
        {activeTab === 'terminal' && (
          <div className="flex-1 overflow-auto p-3">
            {output && <div dangerouslySetInnerHTML={{ __html: output }} />}
            {errors?.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontWeight: 'bold', color: '#DC3545', marginBottom: '6px' }}>⚠️ Errors:</div>
                {errors.map((e, i) => (
                  <div key={i} style={{ color: '#DC3545', marginBottom: '4px' }}>{e}</div>
                ))}
              </div>
            )}
            {!output && !errors?.length && (
              <span style={{ color: '#666' }}>Terminal cleared. Click 'Run' to execute.</span>
            )}
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="flex-1 overflow-auto p-3">
            {events.length === 0 && !running && (
              <span style={{ color: '#999' }}>No output yet — run the code first.</span>
            )}
            {buildRows().map((row, i) => renderRow(row, i))}
            {running && <div style={{ color: '#999' }}>Running...</div>}
            {!submitted && !running && allFilled && (
              <div style={{ marginTop: '10px' }}>
                <button onClick={submitAll} style={{
                  padding: '3px 14px', background: '#8B7355', color: '#fff',
                  border: 'none', borderRadius: '3px', cursor: 'pointer',
                  fontSize: '8pt', fontFamily: 'Consolas, monospace',
                }}>▶ Run</button>
                <span style={{ color: '#999', marginLeft: '8px', fontSize: '8pt' }}>
                  or press Enter on the last input
                </span>
              </div>
            )}
            <div ref={outputEndRef} />
          </div>
        )}

        {activeTab === 'tac' && (
          <div className="flex-1 overflow-auto p-3">
            {tacCode && tacCode.trim().length > 0 ? (() => {
              // ── TAC parser: converts raw TAC lines into table rows ──
              const lines = tacCode.split('\n').filter(l => l.trim());

              // Rename _t0→T1, _t1→T2 etc and _for_st0→L1 etc
              const tempMap = {}, labelMap = {};
              let tempCount = 1, labelCount = 1;
              const rename = (s) => {
                if (!s) return s;
                return s.replace(/_t(\d+)/g, (_, n) => {
                  const key = `_t${n}`;
                  if (!tempMap[key]) tempMap[key] = `T${tempCount++}`;
                  return tempMap[key];
                }).replace(/(_(?:for_st|for_end|wh_st|wh_end|do_st|do_end|if_end|else|sw_end|sw_skip|sw_case|sw_def|L)\w*)/g, (_, lbl) => {
                  if (!labelMap[lbl]) labelMap[lbl] = `L${labelCount++}`;
                  return labelMap[lbl];
                });
              };

              // Pre-scan to build rename maps
              lines.forEach(l => { rename(l); });
              // Reset counts for actual rendering
              Object.keys(tempMap).forEach(k => delete tempMap[k]);
              Object.keys(labelMap).forEach(k => delete labelMap[k]);
              tempCount = 1; labelCount = 1;

              const parseLine = (raw) => {
                const s = raw.trim();
                if (!s || s.startsWith('func_begin') || s.startsWith('func_end')) return null;

                // Label
                if (s.endsWith(':')) {
                  return { type: 'label', label: rename(s.slice(0,-1)) };
                }
                // declare
                if (s.startsWith('declare ')) {
                  let rest = s.slice(8);
                  ['const int ','const double ','const char* ','const bool ',
                   'int ','double ','char* ','bool ','char '].forEach(t => {
                    if (rest.startsWith(t)) rest = rest.slice(t.length);
                  });
                  if (rest.includes(' = ')) {
                    const [name, val] = rest.split(' = ');
                    return { type:'row', op:'=', a1:rename(val), a2:'', res:rename(name) };
                  }
                  return null; // skip bare declares
                }
                // if_false
                if (s.startsWith('if_false ')) {
                  const rest = s.slice(9);
                  const [cond, label] = rest.split(' goto ');
                  return { type:'row', op:'if FALSE', a1:rename(cond), a2:'', res:rename(label) };
                }
                // goto
                if (s.startsWith('goto ')) {
                  return { type:'row', op:'goto', a1:rename(s.slice(5)), a2:'', res:'' };
                }
                // print
                if (s.startsWith('print[')) {
                  const val = s.includes('] ') ? s.split('] ')[1] : '';
                  const clean = val.replace(/^"|"$/g,'');
                  return { type:'row', op:'out', a1:clean === '\\n' ? '\\n' : clean, a2:'', res:'' };
                }
                // return
                if (s.startsWith('return')) {
                  const val = s.slice(6).trim();
                  if (val === '0' || val === '') return { type:'exit' };
                  return { type:'row', op:'return', a1:rename(val), a2:'', res:'' };
                }
                // var++ / var--
                if (s.endsWith('++')) return { type:'row', op:'+', a1:rename(s.slice(0,-2)), a2:'1', res:rename(s.slice(0,-2)) };
                if (s.endsWith('--')) return { type:'row', op:'-', a1:rename(s.slice(0,-2)), a2:'1', res:rename(s.slice(0,-2)) };
                // result = expr
                if (s.includes(' = ')) {
                  const eq = s.indexOf(' = ');
                  const result = s.slice(0, eq);
                  const rhs = s.slice(eq+3);
                  const binOps = ['<=','>=','==','!=','&&','||','<','>','\*\*','+','-','\*','/','%'];
                  for (const bop of ['<=','>=','==','!=','&&','||','<','>','**','+','-','*','/','%']) {
                    const pat = ` ${bop.replace('*','\*')} `;
                    const idx = rhs.indexOf(` ${bop} `);
                    if (idx >= 0) {
                      const left = rhs.slice(0, idx);
                      const right = rhs.slice(idx + bop.length + 2);
                      return { type:'row', op:bop, a1:rename(left), a2:rename(right), res:rename(result) };
                    }
                  }
                  return { type:'row', op:'=', a1:rename(rhs), a2:'', res:rename(result) };
                }
                return null;
              };

              const rows = [];
              let idx = 0;
              lines.forEach(line => {
                const parsed = parseLine(line);
                if (!parsed) return;
                if (parsed.type === 'label') {
                  rows.push({ idx: null, op: parsed.label, a1:'', a2:'', res:'', isLabel: true });
                } else if (parsed.type === 'exit') {
                  rows.push({ idx: idx++, op:'exit', a1:'', a2:'', res:'', isExit: true });
                } else {
                  rows.push({ idx: idx++, ...parsed });
                }
              });

              const th = { background:'#8B7355', color:'#fff', padding:'4px 8px',
                fontWeight:'bold', textAlign:'center', fontSize:'8pt', border:'1px solid #6B5335' };
              const tdBase = { padding:'3px 8px', fontSize:'8pt', border:'1px solid #C4B49A',
                fontFamily:'Consolas,monospace', textAlign:'center' };

              return (
                <table style={{ borderCollapse:'collapse', width:'100%', tableLayout:'fixed' }}>
                  <colgroup>
                    <col style={{width:'10%'}}/>
                    <col style={{width:'18%'}}/>
                    <col style={{width:'24%'}}/>
                    <col style={{width:'24%'}}/>
                    <col style={{width:'24%'}}/>
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={th}>Index</th>
                      <th style={th}>Op</th>
                      <th style={th}>Arg1</th>
                      <th style={th}>Arg2</th>
                      <th style={th}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      if (row.isLabel) {
                        return (
                          <tr key={i} style={{ background:'#D4C4B0' }}>
                            <td colSpan={5} style={{ ...tdBase, textAlign:'left',
                              fontWeight:'bold', color:'#5C3D1E', paddingLeft:'12px' }}>
                              {row.op}:
                            </td>
                          </tr>
                        );
                      }
                      const bg = row.isExit ? '#FDEBD0' : (i % 2 === 0 ? '#F5EFE6' : '#EDE4D8');
                      return (
                        <tr key={i} style={{ background: bg }}>
                          <td style={{ ...tdBase, color:'#888' }}>({row.idx})</td>
                          <td style={{ ...tdBase, color:'#1A5276', fontWeight:'bold' }}>{row.op}</td>
                          <td style={{ ...tdBase, color:'#2E4057' }}>{row.a1}</td>
                          <td style={{ ...tdBase, color:'#2E4057' }}>{row.a2}</td>
                          <td style={{ ...tdBase, color:'#6E2F8A', fontWeight: row.res ? 'bold' : 'normal' }}>{row.res}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })() : (
              <span style={{ color: '#999' }}>No TAC yet — run the code first.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Terminal;