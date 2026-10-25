export const ORIGIN = 'https://ads.tiktok.com';
export const API_ORIGIN = 'https://business-api.tiktok.com';

export const VERSION = globalThis.chrome?.runtime?.getManifest?.().version ?? 'dev';

// Подписи полей, которые MNL-режим переключает в 0/false (значения 1/true).
export const DEFAULT_AUTOMATION_FIELDS = Object.freeze([
  'spc_automation_type', 'spc_upgrade_mode', 'spc_multi_ad_mode',
  'soc_automation_type', 'soc_upgrade_mode', 'soc_multi_ad_mode',
  'universal_type', 'auto_creation_product_type', 'web_all_in_one_catalog'
]);

// Подписи кнопок, по которым агент страницы автоматически включает ручные настройки.
export const DEFAULT_LABELS = Object.freeze([
  'Switch to custom targeting', 'Switch to Custom Mode', 'Custom mode',
  'Manual campaign', 'Select placement', 'Ad group budget', 'Advanced mode',
  'Переключиться на ручной таргетинг', 'Ручной режим', 'Индивидуальный таргетинг',
  'Выбрать плейсмент', 'Расширенный режим', 'Бюджет группы объявлений',
  'Настраиваемая вручную кампания'
]);

export const APPEAL_REASONS = Object.freeze([
  { value: 1, en: "I don't think there's a violation", ru: 'Я не считаю, что есть нарушение' },
  { value: 2, en: 'Rejection reasons too vague', ru: 'Причины отклонения слишком расплывчатые' },
  { value: 3, en: 'I want suggestions for next time', ru: 'Нужны рекомендации на будущее' },
  { value: 4, en: 'Similar ads passed the review', ru: 'Похожие объявления прошли проверку' },
  { value: 5, en: 'None of the above', ru: 'Ничего из перечисленного' }
]);

export const DEFAULT_APPEAL_TEXT =
  'I believe my ad was rejected by mistake. I have reviewed the content and believe it complies with ' +
  'TikTok Advertising Policies and does not contain prohibited content. Please review the ad again. Thank you.';

export const PIXEL_EVENTS = Object.freeze([
  'Purchase', 'CompletePayment', 'CompleteRegistration', 'SubmitForm', 'Lead',
  'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'ViewContent', 'Contact',
  'Subscribe', 'PlaceAnOrder', 'Search', 'ClickButton', 'Download', 'FindLocation'
]);
