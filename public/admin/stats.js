const kpis = document.querySelector('[data-kpis]');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatValue(value, fallback = '-') {
  return value === null || value === undefined ? fallback : String(value);
}

function renderKpis(totals) {
  const cards = [
    ['Total solicitudes', totals.all],
    ['Mes actual', totals.currentMonth],
    ['Activas', totals.active],
    ['Visitas proximas', totals.upcomingVisits],
    ['Ganadas', totals.won],
    ['Perdidas', totals.lost],
    ['Conversion', totals.conversionRate + '%'],
    ['Horas a primer contacto', formatValue(totals.avgFirstContactHours)],
  ];

  kpis.innerHTML = cards.map(([label, value]) => `
    <article class="kpi-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function renderBars(selector, items) {
  const target = document.querySelector(selector);
  const max = Math.max(...items.map((item) => item.value), 1);

  target.innerHTML = `
    <div class="bar-list">
      ${items.map((item) => {
        return `
          <div class="bar-row">
            <div class="bar-row__meta">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
            <div class="bar-row__track">
              <i style="width: ${Math.max((item.value / max) * 100, item.value ? 4 : 0)}%"></i>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadStats() {
  kpis.innerHTML = '<div class="empty">Cargando estadisticas...</div>';
  const response = await fetch('/admin/api/stats', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('No se pudieron cargar estadisticas.');
  const data = await response.json();

  renderKpis(data.totals || {});
  renderBars('[data-chart="status"]', data.distributions?.status || []);
  renderBars('[data-chart="service"]', data.distributions?.service || []);
  renderBars('[data-chart="region"]', data.distributions?.region || []);
  renderBars('[data-chart="daily"]', data.series?.daily || []);
  renderBars('[data-chart="monthly"]', data.series?.monthly || []);
}

document.querySelector('[data-refresh-stats]').addEventListener('click', () => {
  loadStats().catch((error) => {
    kpis.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
  });
});

loadStats().catch((error) => {
  kpis.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
});
