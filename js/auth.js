
import { getSupabase } from "./supabase.js";

const form = document.querySelector("#auth-form");
const msg = form?.querySelector(".form-message");

// Сохраняем путь проекта GitHub Pages
const authPageUrl = new URL("auth.html", window.location.href).href;

form?.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-auth-action]");
  if (!button) return;

  const action = button.dataset.authAction;
  if (!["login", "signup", "reset"].includes(action)) return;

  e.preventDefault();

  if (msg) msg.textContent = "Выполняется...";

  const email = form.elements.email?.value.trim();
  const password = form.elements.password?.value;

  try {
    const db = await getSupabase();

    if (!db) {
      throw new Error(
        "Supabase не подключён. Проверьте js/config.js."
      );
    }

    let result;

    if (action === "login") {
      result = await db.auth.signInWithPassword({
        email,
        password
      });
    }

    if (action === "signup") {
      result = await db.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authPageUrl
        }
      });
    }

    if (action === "reset") {
      result = await db.auth.resetPasswordForEmail(email, {
        redirectTo: authPageUrl
      });
    }

    if (result?.error) {
      throw result.error;
    }

    if (action === "signup") {
      msg.textContent =
        "Регистрация отправлена. Проверьте почту для подтверждения.";
    } else if (action === "reset") {
      msg.textContent =
        "Если аккаунт существует, инструкция будет отправлена на почту.";
    } else {
      msg.textContent = "Вход выполнен!";

      setTimeout(() => {
        window.location.href = new URL(
          "account.html",
          window.location.href
        ).href;
      }, 700);
    }
  } catch (err) {
    console.error("Ошибка Supabase:", err);

    if (msg) {
      msg.textContent =
        err?.message || "Неизвестная ошибка. Откройте Console (F12).";
    }
  }
});
