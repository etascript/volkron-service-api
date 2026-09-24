const state = {
  schedule: null,
};

const els = {
  form: document.querySelector('[data-schedule-form]'),
  slots: document.querySelector('[data-slots]'),
  overrides: document.querySelector('[data-overrides]'),
  feedback: document.querySelector('[data-schedule-feedback]'),
  addSlot: document.querySelector('[data-add-slot]'),
  addOverride: document.querySelector('[data-add-override]'),
};

const weekdays = [
  ['0', 'Domingo'],
  ['1', 'Lunes'],
  ['2', 'Martes'],
  ['3', 'Miercoles'],
  ['4', 'Jueves'],
  ['5', 'Viernes'],
  ['6', 'Sabado'],
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setFeedback(message, type = '') {
  els.feedback.textContent = message;
  els.feedback.className = 'form-feedback' + (type ? ' form-feedback--' + type : '');
}

function option(value, label, current) {
  return `<option value="${escapeHtml(value)}"${String(value) === String(current) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function emptySchedule() {
  return {
    settings: {
      enabled: true,
      timezone: 'America/Santiago',
      lookaheadMonths: 6,
      holidayMode: 'national_block',
    },
    slots: [],
    overrides: [],
  };
}

function slotCard(slot = {}, index = 0) {
  const dayType = slot.dayType || 'weekday';
  return `
    <article class="schedule-card" data-slot-index="${index}">
      <div class="schedule-card__head">
        <strong>Horario ${index + 1}</strong>
        <button class="row-action" type="button" data-remove-slot="${index}">Eliminar</button>
      </div>
      <div class="schedule-grid">
        <label>
          <span>Tipo de dia</span>
          <select data-slot-field="dayType">
            ${option('weekday', 'Dia especifico', dayType)}
            ${option('weekend', 'Fin de semana', dayType)}
            ${option('holiday', 'Feriado', dayType)}
          </select>
        </label>
        <label>
          <span>Dia</span>
          <select data-slot-field="weekday" ${dayType === 'weekday' ? '' : 'disabled'}>
            ${weekdays.map(([value, label]) => option(value, label, slot.weekday ?? 1)).join('')}
          </select>
        </label>
        <label>
          <span>Inicio</span>
          <input data-slot-field="startTime" type="time" value="${escapeHtml(slot.startTime || '09:00')}">
        </label>
        <label>
          <span>Termino</span>
          <input data-slot-field="endTime" type="time" value="${escapeHtml(slot.endTime || '11:00')}">
        </label>
        <label>
          <span>Cupos</span>
          <input data-slot-field="capacity" type="number" min="1" max="100" value="${escapeHtml(slot.capacity || 1)}">
        </label>
        <label class="status-default">
          <input data-slot-field="enabled" type="checkbox" ${slot.enabled === false ? '' : 'checked'}>
          <span>Activo</span>
        </label>
      </div>
    </article>
  `;
}

function overrideSlotRow(slot = {}, overrideIndex, slotIndex) {
  return `
    <div class="override-slot" data-override-slot-index="${slotIndex}">
      <input data-override-slot-field="startTime" type="time" value="${escapeHtml(slot.startTime || '09:00')}" aria-label="Inicio">
      <input data-override-slot-field="endTime" type="time" value="${escapeHtml(slot.endTime || '11:00')}" aria-label="Termino">
      <input data-override-slot-field="capacity" type="number" min="1" max="100" value="${escapeHtml(slot.capacity || 1)}" aria-label="Cupos">
      <button class="row-action" type="button" data-remove-override-slot="${overrideIndex}:${slotIndex}">Quitar</button>
    </div>
  `;
}

function overrideCard(override = {}, index = 0) {
  const mode = override.mode || 'blocked';
  const slots = override.slots || [];
  return `
    <article class="schedule-card" data-override-index="${index}">
      <div class="schedule-card__head">
        <strong>Excepcion ${index + 1}</strong>
        <button class="row-action" type="button" data-remove-override="${index}">Eliminar</button>
      </div>
      <div class="schedule-grid">
        <label>
          <span>Fecha</span>
          <input data-override-field="date" type="date" value="${escapeHtml(override.date || '')}">
        </label>
        <label>
          <span>Modo</span>
          <select data-override-field="mode">
            ${option('blocked', 'Bloquear dia', mode)}
            ${option('custom_slots', 'Usar horarios especiales', mode)}
            ${option('extra_slots', 'Agregar horarios extra', mode)}
          </select>
        </label>
        <label class="schedule-grid--wide">
          <span>Motivo</span>
          <input data-override-field="reason" value="${escapeHtml(override.reason || '')}">
        </label>
      </div>
      <div class="override-slots">
        ${slots.map((slot, slotIndex) => overrideSlotRow(slot, index, slotIndex)).join('')}
      </div>
      <button class="ghost-button schedule-small-button" type="button" data-add-override-slot="${index}">Agregar horario a fecha</button>
    </article>
  `;
}

function render() {
  const schedule = state.schedule || emptySchedule();
  els.form.elements.enabled.checked = Boolean(schedule.settings.enabled);
  els.form.elements.timezone.value = schedule.settings.timezone || 'America/Santiago';
  els.form.elements.lookaheadMonths.value = schedule.settings.lookaheadMonths || 6;
  els.form.elements.holidayMode.value = schedule.settings.holidayMode || 'national_block';
  els.slots.innerHTML = (schedule.slots || []).map(slotCard).join('') || '<div class="empty">Sin horarios configurados.</div>';
  els.overrides.innerHTML = (schedule.overrides || []).map(overrideCard).join('') || '<div class="empty">Sin excepciones configuradas.</div>';
}

function readCardData() {
  const slots = [...els.slots.querySelectorAll('[data-slot-index]')].map((card, index) => {
    const dayType = card.querySelector('[data-slot-field="dayType"]').value;
    return {
      dayType,
      weekday: dayType === 'weekday' ? Number(card.querySelector('[data-slot-field="weekday"]').value) : null,
      startTime: card.querySelector('[data-slot-field="startTime"]').value,
      endTime: card.querySelector('[data-slot-field="endTime"]').value,
      capacity: Number(card.querySelector('[data-slot-field="capacity"]').value || 1),
      enabled: card.querySelector('[data-slot-field="enabled"]').checked,
      sortOrder: index * 10,
    };
  });

  const overrides = [...els.overrides.querySelectorAll('[data-override-index]')].map((card) => {
    const slots = [...card.querySelectorAll('[data-override-slot-index]')].map((row, index) => ({
      startTime: row.querySelector('[data-override-slot-field="startTime"]').value,
      endTime: row.querySelector('[data-override-slot-field="endTime"]').value,
      capacity: Number(row.querySelector('[data-override-slot-field="capacity"]').value || 1),
      sortOrder: index * 10,
    }));
    return {
      date: card.querySelector('[data-override-field="date"]').value,
      mode: card.querySelector('[data-override-field="mode"]').value,
      reason: card.querySelector('[data-override-field="reason"]').value,
      slots,
    };
  });

  return {
    settings: {
      enabled: els.form.elements.enabled.checked,
      timezone: els.form.elements.timezone.value.trim(),
      lookaheadMonths: Number(els.form.elements.lookaheadMonths.value || 6),
      holidayMode: els.form.elements.holidayMode.value,
    },
    slots,
    overrides,
  };
}

async function loadSchedule() {
  setFeedback('Cargando agenda...');
  try {
    const response = await fetch('/admin/api/forms/cotizacion/schedule', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('No se pudo cargar la agenda.');
    state.schedule = await response.json();
    render();
    setFeedback('');
  } catch (error) {
    setFeedback(error.message, 'error');
  }
}

async function saveSchedule(event) {
  event.preventDefault();
  setFeedback('Guardando...');
  try {
    const response = await fetch('/admin/api/forms/cotizacion/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readCardData()),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'No se pudo guardar la agenda.');
    state.schedule = body.schedule;
    render();
    setFeedback('Agenda guardada correctamente.', 'success');
  } catch (error) {
    setFeedback(error.message, 'error');
  }
}

function syncBeforeMutation() {
  state.schedule = { ...(state.schedule || emptySchedule()), ...readCardData() };
}

els.addSlot.addEventListener('click', () => {
  syncBeforeMutation();
  state.schedule.slots.push({
    dayType: 'weekday',
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    capacity: 1,
    enabled: true,
  });
  render();
});

els.addOverride.addEventListener('click', () => {
  syncBeforeMutation();
  state.schedule.overrides.push({
    date: new Date().toISOString().slice(0, 10),
    mode: 'blocked',
    reason: '',
    slots: [],
  });
  render();
});

els.form.addEventListener('change', (event) => {
  if (event.target.matches('[data-slot-field="dayType"]')) {
    const card = event.target.closest('[data-slot-index]');
    const weekday = card.querySelector('[data-slot-field="weekday"]');
    weekday.disabled = event.target.value !== 'weekday';
  }
});

els.form.addEventListener('click', (event) => {
  const removeSlot = event.target.closest('[data-remove-slot]');
  if (removeSlot) {
    syncBeforeMutation();
    state.schedule.slots.splice(Number(removeSlot.dataset.removeSlot), 1);
    render();
    return;
  }

  const removeOverride = event.target.closest('[data-remove-override]');
  if (removeOverride) {
    syncBeforeMutation();
    state.schedule.overrides.splice(Number(removeOverride.dataset.removeOverride), 1);
    render();
    return;
  }

  const addOverrideSlot = event.target.closest('[data-add-override-slot]');
  if (addOverrideSlot) {
    syncBeforeMutation();
    const override = state.schedule.overrides[Number(addOverrideSlot.dataset.addOverrideSlot)];
    override.slots.push({ startTime: '09:00', endTime: '11:00', capacity: 1 });
    render();
    return;
  }

  const removeOverrideSlot = event.target.closest('[data-remove-override-slot]');
  if (removeOverrideSlot) {
    syncBeforeMutation();
    const [overrideIndex, slotIndex] = removeOverrideSlot.dataset.removeOverrideSlot.split(':').map(Number);
    state.schedule.overrides[overrideIndex].slots.splice(slotIndex, 1);
    render();
  }
});

els.form.addEventListener('submit', saveSchedule);
loadSchedule();
