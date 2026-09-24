const statusesEl = document.querySelector('[data-statuses]');
const form = document.querySelector('[data-settings-form]');
let statuses = [];
let defaultStatus = '';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toast(message) {
  const current = document.querySelector('.toast');
  if (current) current.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function render() {
  statusesEl.innerHTML = statuses.map((status, index) => `
    <div class="status-editor-row" data-index="${index}">
      <label>
        <span>Valor interno</span>
        <input name="value" value="${escapeHtml(status.value)}" placeholder="pendiente">
      </label>
      <label>
        <span>Etiqueta visible</span>
        <input name="label" value="${escapeHtml(status.label)}" placeholder="Pendiente">
      </label>
      <label class="status-default">
        <input type="radio" name="defaultStatus" value="${escapeHtml(status.value)}" ${status.value === defaultStatus ? 'checked' : ''}>
        <span>Default</span>
      </label>
      <button class="danger-button" type="button" data-remove-status>Eliminar</button>
    </div>
  `).join('');
}

async function loadSettings() {
  statusesEl.innerHTML = '<div class="empty">Cargando opciones...</div>';
  const response = await fetch('/admin/api/settings', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('No se pudieron cargar opciones.');
  const data = await response.json();
  statuses = (data.statuses || []).map((status) => ({
    value: status.value,
    label: status.label,
    sortOrder: status.sortOrder,
  }));
  defaultStatus = data.defaultStatus || statuses[0]?.value || '';
  render();
}

function collect() {
  statuses = [...statusesEl.querySelectorAll('.status-editor-row')].map((row, index) => {
    const label = row.querySelector('[name="label"]').value.trim();
    const valueInput = row.querySelector('[name="value"]').value;
    return {
      value: slugify(valueInput || label),
      label,
      sortOrder: (index + 1) * 10,
    };
  }).filter((status) => status.value && status.label);

  const checked = statusesEl.querySelector('[name="defaultStatus"]:checked');
  defaultStatus = checked ? slugify(checked.value) : statuses[0]?.value || '';
}

document.querySelector('[data-add-status]').addEventListener('click', () => {
  collect();
  const value = 'nuevo_estado_' + (statuses.length + 1);
  statuses.push({ value, label: 'Nuevo estado', sortOrder: (statuses.length + 1) * 10 });
  if (!defaultStatus) defaultStatus = value;
  render();
});

statusesEl.addEventListener('click', (event) => {
  if (!event.target.hasAttribute('data-remove-status')) return;
  collect();
  const index = Number(event.target.closest('[data-index]').dataset.index);
  statuses.splice(index, 1);
  if (!statuses.some((status) => status.value === defaultStatus)) defaultStatus = statuses[0]?.value || '';
  render();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  collect();
  if (!statuses.length) {
    toast('Debes dejar al menos un estado.');
    return;
  }
  const response = await fetch('/admin/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statuses, defaultStatus }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(body.message || 'No se pudieron guardar opciones.');
    return;
  }
  statuses = (body.statuses || statuses).map((status) => ({
    value: status.value,
    label: status.label,
    sortOrder: status.sortOrder,
  }));
  defaultStatus = statuses.find((status) => status.isDefault)?.value || defaultStatus;
  render();
  toast('Opciones guardadas.');
});

loadSettings().catch((error) => {
  statusesEl.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
});
