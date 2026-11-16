export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value !== null && value !== undefined) el.setAttribute(key, value);
  }
  return el;
}
