import { io } from 'socket.io-client';
const B = 'http://localhost:3001';
const A = await (await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alice@pixora.test',password:'password123'})})).json();
const sA = io(B, { auth: { token: A.token } });
await new Promise(r => sA.on('connect', r));
const me = await (await fetch(B+'/api/me',{headers:{'authorization':'Bearer '+A.token}})).json();
const CID = (await (await fetch(B+'/api/users/charlie')).json()).user?.id;
console.log('alice', me.user.username, '-> charlie', CID);
sA.on('call:answered', ({callId, accept}) => console.log('EVT answered:', accept));
sA.on('call:signal', ({callId, from, data}) => console.log('EVT signal from callee:', Object.keys(data).join(',')));
sA.on('call:ended', () => { console.log('EVT ended'); process.exit(0); });
sA.on('call:started', ({callId}) => {
  console.log('call started', callId);
  // emulate caller overlay: send offer after callee accepts (accept triggers callee to answer; but caller sends offer first)
  setTimeout(() => {
    console.log('sending offer');
    sA.emit('call:signal', { callId, to: CID, data: { offer: { type: 'offer', sdp: 'v=0 fake-offer' } } });
  }, 2500);
});
sA.emit('call:start', { to: CID, kind: 'video' });
setTimeout(() => { console.log('TIMEOUT - exiting'); process.exit(1); }, 30000);
