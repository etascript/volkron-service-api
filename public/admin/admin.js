const state = {
  items: [],
  filters: {},
  selected: null,
  timer: null,
  sortDate: 'desc',
};

const els = {
  quotes: document.querySelector('[data-quotes]'),
  total: document.querySelector('[data-total]'),
  drawer: document.querySelector('[data-drawer]'),
  detail: document.querySelector('[data-detail]'),
  filters: document.querySelectorAll('[data-filter]'),
  refresh: document.querySelector('[data-refresh]'),
  export: document.querySelector('[data-export]'),
};

function statusLabel(value) {
  const item = (state.filters.statuses || []).find((status) => status.value === value);
  return item ? item.label : value;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function filterParams() {
  const params = new URLSearchParams();
  els.filters.forEach((field) => {
    if (field.value) params.set(field.dataset.filter, field.value);
  });
  params.set('limit', '1000');
  return params;
}

function sortedItems() {
  return [...state.items].sort((a, b) => {
    const left = String(a.created_at || '');
    const right = String(b.created_at || '');
    return state.sortDate === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
  });
}

function optionList(values, current, firstLabel) {
  return ['<option value="">' + firstLabel + '</option>']
    .concat(
      (values || []).map((value) => {
        const selected = value === current ? ' selected' : '';
        return '<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(value) + '</option>';
      }),
    )
    .join('');
}

function syncFilterOptions(filters) {
  const current = {};
  els.filters.forEach((field) => {
    current[field.dataset.filter] = field.value;
  });

  const status = document.querySelector('[data-filter="status"]');
  const region = document.querySelector('[data-filter="region"]');
  const comuna = document.querySelector('[data-filter="comuna"]');
  const service = document.querySelector('[data-filter="service"]');

  if (status) {
    status.innerHTML = ['<option value="">Todos</option>']
      .concat(
        (filters.statuses || []).map((statusItem) => {
          const selected = statusItem.value === current.status ? ' selected' : '';
          return '<option value="' + escapeHtml(statusItem.value) + '"' + selected + '>' + escapeHtml(statusItem.label) + '</option>';
        }),
      )
      .join('');
  }
  if (region) region.innerHTML = optionList(filters.regions, current.region, 'Todas');
  if (comuna) comuna.innerHTML = optionList(filters.comunas, current.comuna, 'Todas');
  if (service) service.innerHTML = optionList(filters.services, current.service, 'Todos');
}

function quoteRow(item) {
  const quote = item.quote || {};
  const visit = [quote.fecha_visita, quote.horario].filter(Boolean).join(' - ') || 'Sin fecha';
  return `
    <tr class="quote-row" data-open="${escapeHtml(item.id)}" tabindex="0">
      <td data-label="Fecha">${escapeHtml(formatDate(item.created_at))}</td>
      <td data-label="Estado"><span class="status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td data-label="Nombre"><strong>${escapeHtml(quote.nombre || '-')}</strong><span>${escapeHtml(quote.rut || '-')}</span></td>
      <td data-label="Contacto"><strong>${escapeHtml(quote.telefono || '-')}</strong><span>${escapeHtml(quote.email || '-')}</span></td>
      <td data-label="Ubicacion"><strong>${escapeHtml(quote.region || '-')}</strong><span>${escapeHtml(quote.comuna || '-')}</span></td>
      <td data-label="Servicio"><strong>${escapeHtml(quote.tipo_servicio || '-')}</strong><span>${escapeHtml(visit)}</span></td>
      <td data-label="Accion"><button class="row-action" type="button" data-open="${escapeHtml(item.id)}">Ver</button></td>
    </tr>
  `;
}

function renderQuotes() {
  const items = sortedItems();
  els.total.textContent = String(items.length);

  if (!items.length) {
    els.quotes.innerHTML = '<div class="empty">No hay solicitudes con los filtros actuales.</div>';
    return;
  }

  const direction = state.sortDate === 'asc' ? 'Asc' : 'Desc';
  els.quotes.innerHTML = `
    <div class="quotes-table-wrap">
      <table class="quotes-table">
        <thead>
          <tr>
            <th><button type="button" class="sort-button" data-sort-date>Fecha <span>${direction}</span></button></th>
            <th>Estado</th>
            <th>Nombre / RUT</th>
            <th>Contacto</th>
            <th>Ubicacion</th>
            <th>Servicio / Visita</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(quoteRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function detailField(label, value) {
  return `
    <div>
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="detail-value">${escapeHtml(value || '-')}</div>
    </div>
  `;
}

function statusOptions(current) {
  return (state.filters.statuses || []).map((statusItem) => {
    const selected = statusItem.value === current ? ' selected' : '';
    return '<option value="' + escapeHtml(statusItem.value) + '"' + selected + '>' + escapeHtml(statusItem.label) + '</option>';
  }).join('');
}

function timeline(item) {
  const history = item.status_history || [];
  if (!history.length) return '<p class="empty-inline">Sin historial.</p>';

  return `
    <ol class="timeline">
      ${history.map((event) => `
        <li>
          <span class="timeline__date">${escapeHtml(formatDate(event.changed_at))}</span>
          <strong>${escapeHtml(statusLabel(event.status))}</strong>
          ${event.note ? '<p>' + escapeHtml(event.note) + '</p>' : ''}
        </li>
      `).join('')}
    </ol>
  `;
}

function renderDetail(item) {
  const quote = item.quote || {};
  els.detail.innerHTML = `
    <span class="status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
    <h2 class="detail-title">${escapeHtml(quote.nombre)}</h2>
    <p>${escapeHtml(formatDate(item.created_at))}</p>

    <section class="detail-section">
      <div class="detail-grid">
        ${detailField('RUT', quote.rut)}
        ${detailField('Telefono', quote.telefono)}
        ${detailField('Email', quote.email)}
        ${detailField('Origen', quote.servicio_origen)}
        ${detailField('Region', quote.region)}
        ${detailField('Comuna', quote.comuna)}
        ${detailField('Servicio', quote.tipo_servicio)}
        ${detailField('Visita', [quote.fecha_visita, quote.horario].filter(Boolean).join(' - '))}
      </div>
    </section>

    <section class="detail-section">
      <span class="field-label">Detalle</span>
      <div class="detail-value">${escapeHtml(quote.detalle || 'Sin detalle')}</div>
    </section>

    <section class="detail-section">
      <span class="field-label">Historial</span>
      ${timeline(item)}
    </section>

    <section class="detail-section">
      <form class="status-form" data-status-form>
        <label>
          <span class="field-label">Cambiar estado</span>
          <select name="status">${statusOptions(item.status)}</select>
        </label>
        <label>
          <span class="field-label">Nota interna</span>
          <textarea name="note" placeholder="Opcional"></textarea>
        </label>
        <button class="primary-button" type="submit">Guardar estado</button>
      </form>
    </section>
  `;
}

function openDrawer(id) {
  const item = state.items.find((quote) => quote.id === id);
  if (!item) return;

  state.selected = item;
  renderDetail(item);
  els.drawer.classList.add('is-open');
  els.drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  els.drawer.classList.remove('is-open');
  els.drawer.setAttribute('aria-hidden', 'true');
  state.selected = null;
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

async function loadQuotes() {
  els.quotes.innerHTML = '<div class="empty">Cargando solicitudes...</div>';
  try {
    const response = await fetch('/admin/api/quotes?' + filterParams().toString(), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('No se pudieron cargar las cotizaciones.');
    const payload = await response.json();
    state.items = payload.items || [];
    state.filters = payload.filters || {};
    syncFilterOptions(state.filters);
    renderQuotes();
  } catch (error) {
    els.quotes.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
  }
}

async function saveStatus(event) {
  event.preventDefault();
  if (!state.selected) return;

  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  const payload = {
    status: form.elements.status.value,
    note: form.elements.note.value,
  };

  if (button) {
    button.disabled = true;
    button.textContent = 'Guardando...';
  }

  try {
    const response = await fetch('/admin/api/quotes/' + encodeURIComponent(state.selected.id) + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'No se pudo guardar el estado.');
    const selectedId = state.selected.id;
    toast('Estado actualizado.');
    await loadQuotes();
    const updated = state.items.find((item) => item.id === selectedId);
    if (updated) {
      state.selected = updated;
      renderDetail(updated);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Guardar estado';
    }
  }
}

function csvCell(value) {
  return '"' + String(value || '').replace(/"/g, '""') + '"';
}

function exportCurrentView() {
  const headers = [
    'ID',
    'Fecha creacion',
    'Estado',
    'Nombre',
    'RUT',
    'Telefono',
    'Email',
    'Region',
    'Comuna',
    'Servicio',
    'Origen',
    'Fecha visita',
    'Horario',
    'Detalle',
    'Ultima nota',
  ];

  const rows = sortedItems().map((item) => {
    const quote = item.quote || {};
    return [
      item.id,
      item.created_at,
      statusLabel(item.status),
      quote.nombre,
      quote.rut,
      quote.telefono,
      quote.email,
      quote.region,
      quote.comuna,
      quote.tipo_servicio,
      quote.servicio_origen,
      quote.fecha_visita,
      quote.horario,
      quote.detalle,
      item.status_note,
    ];
  });

  const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'cotizaciones-volkron-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

els.filters.forEach((field) => {
  field.addEventListener('input', () => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(loadQuotes, 250);
  });
  field.addEventListener('change', loadQuotes);
});

els.refresh.addEventListener('click', loadQuotes);
els.export.addEventListener('click', exportCurrentView);
els.quotes.addEventListener('click', (event) => {
  const sort = event.target.closest('[data-sort-date]');
  if (sort) {
    state.sortDate = state.sortDate === 'asc' ? 'desc' : 'asc';
    renderQuotes();
    return;
  }

  const opener = event.target.closest('[data-open]');
  if (opener) openDrawer(opener.dataset.open);
});
els.quotes.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-open]');
  if (!row) return;
  event.preventDefault();
  openDrawer(row.dataset.open);
});
els.drawer.addEventListener('click', (event) => {
  if (event.target.hasAttribute('data-close-drawer')) closeDrawer();
});
els.detail.addEventListener('submit', (event) => {
  if (event.target.matches('[data-status-form]')) saveStatus(event);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

loadQuotes();
