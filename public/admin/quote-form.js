const form = document.querySelector('[data-quote-form]');
const feedback = document.querySelector('[data-form-feedback]');

function setFeedback(message, type = '') {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = 'form-feedback' + (type ? ' form-feedback--' + type : '');
}

function clearErrors() {
  form.querySelectorAll('.is-invalid').forEach((field) => field.classList.remove('is-invalid'));
  form.querySelectorAll('.field-error').forEach((error) => error.remove());
}

function showFieldError(name, message) {
  const field = form.elements[name];
  if (!field) return;
  field.classList.add('is-invalid');
  const error = document.createElement('small');
  error.className = 'field-error';
  error.textContent = message;
  field.closest('label')?.appendChild(error);
}

function payloadFromForm() {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()]));
}

async function submitQuote(event) {
  event.preventDefault();
  clearErrors();
  setFeedback('');

  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Guardando...';
  }

  try {
    const response = await fetch('/admin/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFromForm()),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      (body.issues || []).forEach((issue) => showFieldError(issue.path?.[0], issue.message));
      throw new Error(body.message || 'No se pudo guardar la solicitud.');
    }

    setFeedback('Solicitud creada correctamente.', 'success');
    form.reset();
    window.setTimeout(() => {
      window.location.href = '/admin';
    }, 900);
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Guardar solicitud';
    }
  }
}

if (form) form.addEventListener('submit', submitQuote);
