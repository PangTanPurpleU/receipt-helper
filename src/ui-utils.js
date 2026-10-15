export const storageError=e=>e?.name==='QuotaExceededError'?'浏览器存储空间不足，请先导出备份并释放设备空间后重试。':e?.message||String(e);
// Persistent storage is a best-effort request; denial must not block saving.
export async function requestPersistence(storage=globalThis.navigator?.storage){try{return Boolean(await storage?.persist?.());}catch{return false;}}
export function localDay(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
