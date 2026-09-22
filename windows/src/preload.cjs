const {contextBridge, ipcRenderer} = require('electron');
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('jev', {
  getSettings: () => invoke('settings:get'),
  ntqqDiscover: root => invoke('ntqq:discover',root),
  ntqqChooseRoot: () => invoke('ntqq:choose-root'),
  ntqqRead: account => invoke('ntqq:read',account),
  ntqqImport: input => invoke('ntqq:import',input),
  ntqqCancel: () => invoke('ntqq:cancel'),
  onNtqqProgress: callback => ipcRenderer.on('ntqq-progress',(_event,value)=>callback(value)),
  saveSettings: data => invoke('settings:save', data),
  listWindows: () => invoke('windows:list'),
  capture: id => invoke('windows:capture', id),
  recognize: rect => invoke('ocr:recognize', rect),
  analyze: input => invoke('analysis:run', input),
  cancel: () => invoke('analysis:cancel'),
  copy: text => invoke('clipboard:copy', text),
  fill: text => invoke('reply:fill', text),
  clear: () => invoke('session:clear'),
  onOcrProgress: callback => ipcRenderer.on('ocr-progress', (_event, value) => callback(value)),
  historyList: () => invoke('history:list'),
  historyImport: input => invoke('history:import', input),
  historyProfile: id => invoke('history:profile', id),
  historyPlan: id => invoke('history:plan', id),
  historySummarize: id => invoke('history:summarize', id),
  historyCancel: () => invoke('history:cancel'),
  historyEvidence: (id,refs) => invoke('history:evidence',id,refs),
  historyDelete: id => invoke('history:delete',id),
  onHistoryProgress: callback => ipcRenderer.on('history-progress',(_event,value)=>callback(value))
});
