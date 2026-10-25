// Обмен сообщениями интерфейс → сервис-воркер.
export async function call(ns, type, payload = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ ns, type, ...payload });
  } catch {
    throw new Error('Фоновый процесс расширения недоступен. Перезагрузите расширение в chrome://extensions.');
  }
  if (!response) throw new Error('Нет ответа от расширения. Повторите действие.');
  if (!response.ok) {
    const error = new Error(response.error || 'Неизвестная ошибка');
    error.code = response.code;
    throw error;
  }
  return response.data;
}

export const manual = {
  status: (tabId) => call('manual', 'status', { tabId }),
  activate: (tabId, account) => call('manual', 'activate', { tabId, account }),
  timezone: (tabId) => call('manual', 'timezone', { tabId }),
  cancel: (tabId) => call('manual', 'cancel', { tabId }),
  interceptor: (tabId, enabled) => call('manual', 'interceptor', { tabId, enabled })
};

export const appeals = {
  scan: (tabId) => call('appeals', 'scan', { tabId }),
  resolve: (tabId, account, rows) => call('appeals', 'resolve', { tabId, account, rows }),
  start: (payload) => call('appeals', 'start', payload),
  batch: () => call('appeals', 'batch'),
  cancel: () => call('appeals', 'cancel'),
  history: () => call('appeals', 'history'),
  unblock: (jobId) => call('appeals', 'unblock', { jobId }),
  clear: () => call('appeals', 'clear')
};

export const s2s = {
  test: (input) => call('s2s', 'test', { input }),
  pixel: (tabId, options) => call('s2s', 'pixel', { tabId, options })
};

export const journal = { get: () => call('journal', 'get'), clear: () => call('journal', 'clear') };

export const settings = {
  get: () => call('settings', 'get'),
  save: (value) => call('settings', 'save', { settings: value }),
  patch: (patch) => call('settings', 'patch', { patch })
};
