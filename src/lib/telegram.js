export function getTelegramWebApp() {
  return typeof window !== "undefined" && window.Telegram?.WebApp ? window.Telegram.WebApp : null;
}

export function isTelegramMiniApp() {
  const webApp = getTelegramWebApp();
  return Boolean(webApp?.initData);
}
