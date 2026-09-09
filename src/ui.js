// Builds one form control per schema field. Pure DOM, no framework.

import { fieldOptions, validate, ABOUT, toInputValue, fromInputValue, DT_MIN_YEAR, DT_MAX_YEAR } from './schema.js';

const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) node.append(kid);
  return node;
};

// A row of buttons where exactly one is pressed. It repaints itself on click,
// so the control shows the pending value rather than the value on the card.
// onChange returning false means the value was rejected and the old one stands.
function segmented(items, value, onChange) {
  const group = el('div', { className: 'seg', role: 'group' });
  const buttons = new Map();

  const paint = (chosen) => {
    for (const [v, button] of buttons) button.setAttribute('aria-pressed', String(v === chosen));
  };

  for (const [v, label] of items) {
    const button = el('button', { type: 'button', textContent: label });
    button.onclick = () => {
      if (onChange(v) !== false) paint(v);
    };
    buttons.set(v, button);
    group.append(button);
  }

  paint(value);
  return group;
}

function enumControl(field, value, fps, onChange) {
  const options = fieldOptions(field, fps);
  // A couple of choices read better as buttons than a dropdown.
  if (options.length <= 3) return segmented(options, value, onChange);

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
  return segmented([[field.on, 'On'], [field.off, 'Off']], value, onChange);
}

function textControl(field, value, onChange) {
  const input = el('input', { type: 'text', value: value ?? '' });
  if (field.maxLength) input.maxLength = field.maxLength;
  input.oninput = () => onChange(input.value);
  return input;
}

// The clock is stamped on save rather than edited in place, because a camera
// whose clock is wrong dates every file it records wrong, and a button you have
// to remember is a button nobody presses. "Pick a date" is there for the case
// where the current time is not what you want.
function clockControl(value, ctx) {
  const wrap = el('div', { className: 'stack-sm' });
  const error = el('p', { className: 'err', hidden: true });

  const picker = el('input', { type: 'datetime-local', step: '1' });
  picker.value = ctx.clockCustom() || toInputValue(value);
  picker.setAttribute('aria-label', 'Date and time to set on the camera');

  const validatePicker = () => {
    const ok = fromInputValue(picker.value);
    error.textContent = ok
      ? ''
      : `Enter a date and time between ${DT_MIN_YEAR} and ${DT_MAX_YEAR}`;
    error.hidden = Boolean(ok);
    return Boolean(ok);
  };

  picker.oninput = () => {
    ctx.setClockCustom(picker.value);
    validatePicker();
  };

  const showPicker = () => {
    const custom = ctx.clockMode() === 'custom';
    picker.hidden = !custom;
    if (custom) validatePicker();
    else error.hidden = true;
  };

  const seg = segmented(
    [['now', 'Set to now'], ['custom', 'Pick a date'], ['off', 'Leave alone']],
    ctx.clockMode(),
    (mode) => {
      ctx.setClockMode(mode);
      showPicker();
      return true;
    }
  );

  showPicker();
  wrap.append(seg, picker, error);
  return wrap;
}

// A hoverable "i" that explains what a setting does. Also opens on click, so it
// works on touch, and on keyboard focus.
function infoButton(tipId, text) {
  const wrap = el('span', { className: 'info-wrap' });
  const button = el('button', { type: 'button', className: 'info', textContent: 'i' });
  button.setAttribute('aria-label', 'What this setting does');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-describedby', tipId);

  const tip = el('span', { className: 'tip', id: tipId, role: 'tooltip', textContent: text });

  const setOpen = (open) => {
    wrap.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.onclick = () => setOpen(!wrap.classList.contains('open'));
  button.onkeydown = (e) => {
    if (e.key === 'Escape') setOpen(false);
  };
  button.onblur = () => setOpen(false);

  wrap.append(button, tip);
  return wrap;
}

// Renders a labelled row and keeps its inline validation message in sync.
export function fieldRow(field, key, value, ctx) {
  const id = `f-${key.replace(/\W+/g, '-')}`;
  const error = el('p', { className: 'err', hidden: true, id: `${id}-err` });

  // Returns false when the value is rejected, so a control can keep showing the
  // value that is actually staged rather than the one that was refused.
  const onChange = (next) => {
    const message = validate(field, next, ctx.fps());
    error.textContent = message ?? '';
    error.hidden = !message;
    if (message) return false;
    ctx.commit(key, next);
    return true;
  };

  let control;
  if (field.type === 'enum') control = enumControl(field, value, ctx.fps(), onChange);
  else if (field.type === 'range') control = rangeControl(field, value, onChange);
  else if (field.type === 'toggle') control = toggleControl(field, value, onChange);
  else if (field.type === 'clock') control = clockControl(value, ctx);
  else control = textControl(field, value, onChange);

  // Button groups have no single labelable element, so they get an accessible
  // group name instead of a `for` association.
  const labelable = control.tagName === 'SELECT' || control.tagName === 'INPUT';
  if (labelable) control.id = id;
  else control.setAttribute('aria-label', field.label);

  const label = el('label', labelable ? { htmlFor: id } : {});
  label.append(field.label);
  const about = ABOUT[field.id];
  if (about) label.append(' ', infoButton(`${id}-tip`, about));
  const hint = typeof field.hint === 'function' ? field.hint(value) : field.hint;
  if (hint) label.append(el('span', { className: 'hint', textContent: hint }));

  const row = el('div', { className: 'row' }, [label, control]);
  row.dataset.key = key;
  row.append(error);
  return row;
}

export { el };
