self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",()=>{});
self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type!=="FLEXAR_NOTIFICATION") return;
  const title=data.title||"FLEXAR AI";
  const options={...(data.options||{}),icon:"/flexa-symbol.webp",badge:"/flexa-symbol.webp"};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    const existing=list.find(client=>client.url.startsWith(self.location.origin));
    if(existing){existing.focus();existing.navigate(target);return;}
    return clients.openWindow(target);
  }));
});