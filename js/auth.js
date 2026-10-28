
import { getSupabase } from "./supabase.js";

const form = document.querySelector("#auth-form");
const msg = form?.querySelector(".form-message");

const authPageUrl = new URL("auth.html", window.location.href).href;
const accountPageUrl = new URL("account.html", window.location.href).href;

function showMessage(text, isError = false) {
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = isError ? "#d93025" : "";
}

form?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-auth-action]");
  if (!button || !form.contains(button)) return;

  const action = button.dataset.authAction;

  if (!["login", "signup", "reset"].includes(action)) return;

  event.preventDefault();

  const emailInput = form.querySelector(
    'input[name="email"], input[type="email"], #email'
  );

  const passwordInput = form.querySelector(
    'input[name="password"], input[type="password"], #password'
  );

  const email = emailInput?.value.trim() || "";
  const password = passwordInput?.value || "";

  if (!email) {
    showMessage("Введите адрес электронной почты.", true);
    emailInput?.focus();
    return;
  }

  if (action !== "reset" && !password) {
    showMessage("Введите пароль.", true);
    passwordInput?.focus();
    return;
  }

  if (action !== "reset" && password.length < 6 && action === "signup") {
    showMessage("Пароль должен содержать не менее 6 символов.", true);
    passwordInput?.focus();
    return;
  }

  button.disabled = true;
  showMessage("Пожалуйста, подождите...");

  try {
    const db = await getSupabase();

    if (!db) {
      throw new Error(
        "Supabase не подключён. Проверьте js/config.js и js/supabase.js."
      );
    }

    let result;

    switch (action) {
      case "login":
        result = await db.auth.signInWithPassword({
          email,
          password
        });
        break;

      case "signup":
        result = await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: authPageUrl
          }
        });
        break;

      case "reset":
        result = await db.auth.resetPasswordForEmail(email, {
          redirectTo: authPageUrl
        });
        break;
    }

    if (result?.error) {
      throw result.error;
    }

    if (action === "signup") {
      if (result?.data?.session) {
        showMessage("Регистрация успешна! Перенаправляем...");
        window.location.href = accountPageUrl;
      } else {
        showMessage(
          "Запрос на регистрацию выполнен. Проверьте почту для подтверждения."
        );
      }
    } else if (action === "reset") {
      showMessage(
        "Если аккаунт с таким адресом существует, инструкция будет отправлена на почту."
      );
    } else {
      showMessage("Вход выполнен успешно!");
      window.location.href = accountPageUrl;
    }
  } catch (error) {
    console.error("Ошибка Supabase:", error);

    const message = error?.message || "Неизвестная ошибка.";

    const friendlyMessages = {
      "Invalid login credentials":
        "Неверный email или пароль.",
      "Email not confirmed":
        "Сначала подтвердите email по ссылке из письма.",
      "User already registered":
        "Этот email уже зарегистрирован. Попробуйте войти.",
      "Password should be at least 6 characters":
        "Пароль должен содержать не менее 6 символов.",
      "missing email or phone":
        "Email не найден. Проверьте поле email в auth.html."
    };

    showMessage(friendlyMessages[message] || `Ошибка: ${message}`, true);
  } finally {
    button.disabled = false;
  }
});
