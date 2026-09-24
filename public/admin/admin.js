const state = {
  items: [],
  filters: {},
  selected: null,
  timer: null,
};

const statusLabels = {
  received: 'Recibida',
  pending: 'Pendiente',
  contacted: 'Contactado',
  quoted: 'Cotizada',
  scheduled: 'Agendada',
  won: 'Ganada',
  lost: 'Perdida',
  cancelled: 'Cancelada',
};

const els = {
  quotes: document.querySelector('[data-quotes]'),
  total: document.querySelector('[data-total]'),
  drawer: document.querySelector('[data-drawer]'),
  detail: document.querySelector('[data-detail]'),
  filters: document.querySelectorAll('[data-filter]'),
  refresh: document.querySelector('[data-refresh]'),
};

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
    dateStyle: 'medium',
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
        (filters.statuses || []).map((value) => {
          const selected = value === current.status ? ' selected' : '';
          return '<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(statusLabels[value] || value) + '</option>';
        }),
      )
      .join('');
  }
  if (region) region.innerHTML = optionList(filters.regions, current.region, 'Todas');
  if (comuna) comuna.innerHTML = optionList(filters.comunas, current.comuna, 'Todas');
  if (service) service.innerHTML = optionList(filters.services, current.service, 'Todos');
}

function quoteCard(item) {
  const quote = item.quote || {};
  return `
    <article class="quote-card">
      <button class="quote-card__button" type="button" data-open="${escapeHtml(item.id)}">
        <div class="quote-card__head">
          <div>
            <h2>${escapeHtml(quote.nombre)}</h2>
            <p>${escapeHtml(formatDate(item.created_at))}</p>
          </div>
          <span class="status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
        </div>
        <div>
          <span class="field-label">Contacto</span>
          <strong>${escapeHtml(quote.telefono || '-')}</strong>
          <p>${escapeHtml(quote.email || '-')}</p>
        </div>
        <div>
          <span class="field-label">Ubicacion</span>
          <strong>${escapeHtml(quote.region || '-')}</strong>
          <p>${escapeHtml(quote.comuna || '-')}</p>
        </div>
        <div>
          <span class="field-label">Servicio</span>
          <strong>${escapeHtml(quote.tipo_servicio || '-')}</strong>
          <p>${escapeHtml(quote.fecha_visita || 'Sin fecha')} ${escapeHtml(quote.horario || '')}</p>
        </div>
        <span class="field-label">Ver detalle</span>
      </button>
    </article>
  `;
}

function renderQuotes() {
  els.total.textContent = String(state.items.length);

  if (!state.items.length) {
    els.quotes.innerHTML = '<div class="empty">No hay solicitudes con los filtros actuales.</div>';
    return;
  }

  els.quotes.innerHTML = state.items.map(quoteCard).join('');
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
  return (state.filters.statuses || []).map((status) => {
    const selected = status === current ? ' selected' : '';
    return '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(statusLabels[status] || status) + '</option>';
  }).join('');
}

function renderDetail(item) {
  const quote = item.quote || {};
  els.detail.innerHTML = `
    <span class="status-pill" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
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
      <form class="status-form" data-status-form>
        <label>
          <span class="field-label">Cambiar estado</span>
          <select name="status">${statusOptions(item.status)}</select>
        </label>
        <label>
          <span class="field-label">Nota interna</span>
          <textarea name="note" placeholder="Opcional">${escapeHtml(item.status_note || '')}</textarea>
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
    toast('Estado actualizado.');
    await loadQuotes();
    const updated = state.items.find((item) => item.id === state.selected.id);
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

els.filters.forEach((field) => {
  field.addEventListener('input', () => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(loadQuotes, 250);
  });
  field.addEventListener('change', loadQuotes);
});

els.refresh.addEventListener('click', loadQuotes);
els.quotes.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open]');
  if (button) openDrawer(button.dataset.open);
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
