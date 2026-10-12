"use strict";

const form = document.getElementById("login-form");
const submit = document.getElementById("submit");
const formError = document.getElementById("form-error");

function clearErrors() {
  for (const slot of document.querySelectorAll("[data-error]")) {
    slot.textContent = "";
  }
  formError.textContent = "";
}

function showErrors(errors) {
  for (const [field, messages] of Object.entries(errors)) {
    const slot = document.querySelector(`[data-error="${field}"]`);
    if (slot) slot.textContent = messages.join(" ");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  submit.disabled = true;
  submit.textContent = "Signing in…";

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
      }),
    });

    if (response.ok) {
      location.href = "/chat";
      return;
    }

    const data = await response.json().catch(() => null);
    if (response.status === 400 && data && data.errors) {
      showErrors(data.errors);
    } else {
      formError.textContent =
        (data && data.message) || "Sign in failed. Please try again.";
    }
  } catch {
    formError.textContent = "Sign in failed. Please try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});
