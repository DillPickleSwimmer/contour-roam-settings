// Builds one form control per schema field. Pure DOM, no framework.

import { fieldOptions, validate } from './schema.js';

const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) node.append(kid);
  return node;
};

function enumControl(field, value, fps, onChange) {
  const options = fieldOptions(field, fps);
  // A couple of choices read better as buttons than a dropdown.
  if (options.length <= 3) {
    const seg = el('div', { className: 'seg', role: 'group' });
    for (const [v, label] of options) {
      const b = el('button', { type: 'button', textContent: label });
      b.setAttribute('aria-pressed', String(v === value));
      b.onclick = () => onChange(v);
      seg.append(b);
    }
    return seg;
  }
  const select = el('select');
  let matched = false;
  for (const [v, label] of options) {
    const opt = el('option', { value: v, textContent: label });
    if (v === value) (opt.selected = true), (matched = true);
    select.append(opt);
  }
  // Never silently retarget a value the camera wrote but we don't recognise.
  if (!matched && value !== undefined) {
    select.prepend(el('option', { value, textContent: `${value} (unrecognised)`, selected: true }));
  }
  select.onchange = () => onChange(select.value);
  return select;
}

function rangeControl(field, value, onChange) {
  const input = el('input', {
    type: 'range', min: String(field.min), max: String(field.max),
    step: String(field.step ?? 1), value: String(Number(value)),
  });
  const out = el('span', { className: 'val', textContent: readout(field, value) });
  input.oninput = () => {
    out.textContent = readout(field, input.value);
    onChange(input.value);
  };
  return el('div', { className: 'ctl' }, [input, out]);
}

const readout = (field, value) =>
  field.unit ? `${Math.round(Number(value))} ${field.unit}` : String(Math.round(Number(value)));

function toggleControl(field, value, onChange) {
  const wrap = el('div', { className: 'seg', role: 'group' });
  for (const [v, label] of [[field.on, 'On'], [field.off, 'Off']]) {
    const b = el('button', { type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(v === value));
    b.onclick = () => onChange(v);
    wrap.append(b);
  }
  return wrap;
}

function textControl(field, value, onChange) {
  const input = el('input', { type: 'text', value: value ?? '' });
  if (field.maxLength) input.maxLength = field.maxLength;
  input.oninput = () => onChange(input.value);
  return input;
}

function datetimeControl(value, onChange, onSync) {
  const label = el('span', { className: 'val', style: 'min-width:0;text-align:left;flex:1', textContent: value || '—' });
  const sync = el('button', { type: 'button', textContent: 'Set to now' });
  sync.onclick = () => {
    const next = onSync();
    label.textContent = next;
    onChange(next);
  };
  return el('div', { className: 'ctl' }, [label, sync]);
}

// Renders a labelled row and keeps its inline validation message in sync.
export function fieldRow(field, key, value, ctx) {
  const id = `f-${key.replace(/\W+/g, '-')}`;
  const error = el('p', { className: 'err', hidden: true, id: `${id}-err` });

  const onChange = (next) => {
    const message = validate(field, next, ctx.fps());
    error.textContent = message ?? '';
    error.hidden = !message;
    if (!message) ctx.commit(key, next);
  };

  let control;
  if (field.type === 'enum') control = enumControl(field, value, ctx.fps(), onChange);
  else if (field.type === 'range') control = rangeControl(field, value, onChange);
  else if (field.type === 'toggle') control = toggleControl(field, value, onChange);
  else if (field.type === 'datetime') control = datetimeControl(value, onChange, ctx.now);
  else control = textControl(field, value, onChange);

  // Button groups have no single labelable element, so they get an accessible
  // group name instead of a `for` association.
  const labelable = control.tagName === 'SELECT' || control.tagName === 'INPUT';
  if (labelable) control.id = id;
  else control.setAttribute('aria-label', field.label);

  const label = el('label', labelable ? { htmlFor: id } : {});
  label.append(field.label);
  if (field.hint) label.append(el('span', { className: 'hint', textContent: field.hint }));

  const row = el('div', { className: 'row' }, [label, control]);
  row.append(error);
  return row;
}

export { el };
