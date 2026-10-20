/**
 * 나의 생애주기 금융 설계 — PDF 수신기
 * Deploy as web app: execute as folder owner, access anyone.
 * The browser calls only doPost; no list/read/delete endpoint is exposed.
 * Put this deployment's /exec URL in life.html DRIVE_UPLOAD_URL after authorization.
 */
const SETTINGS = Object.freeze({
  folderId: '1YvlPnksToDThz0If5Efh_jiF4OteGwnd',
  origin: 'https://kste200267-boop.github.io',
  passwordHash: '516888deaa262edcf15d719ec71e02f0a1b8353bdc6c6d4f9d784bd561b67cad',
  maxBytes: 5 * 1024 * 1024,
  classes: ['스마트용접과 1반','스마트용접과 2반','융합기계과 1반','융합기계과 2반','스마트금형과 1반','스마트금형과 2반']
});
function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function validate_(p) {
  if (digest_(p.password || '') !== SETTINGS.passwordHash) throw new Error('시험 비밀번호를 다시 확인해 주세요.');
  if (!/^[123]$/.test(p.grade || '') || SETTINGS.classes.indexOf(p.cls)<0 || !/^\d{1,2}$/.test(p.number || '') || +p.number<1 || +p.number>40) throw new Error('학년·학과·반·번호를 확인해 주세요.');
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,29}$/u.test(p.name || '') || p.name !== p.name.trim().replace(/\s+/g,' ')) throw new Error('이름을 확인해 주세요.');
  const name=p.grade+'학년 '+p.cls+' '+Number(p.number)+'번 '+p.name+'.pdf';
  if(p.fileName!==name) throw new Error('파일 이름과 학생 정보가 일치하지 않아요.');
  if (!p.pdf || p.pdf.length>Math.ceil(SETTINGS.maxBytes/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.pdf)) throw new Error('PDF 형식 또는 크기를 확인해 주세요.');
  const bytes=Utilities.base64Decode(p.pdf);
  if(bytes.length>SETTINGS.maxBytes || bytes.length<100 || String.fromCharCode.apply(null,bytes.slice(0,5))!=='%PDF-') throw new Error('올바른 PDF 파일이 아니에요.');
  return {name:name,bytes:bytes,key:'receipt_'+digest_(name+'|'+p.pdf)};
}
function doPost(e) {
  const p=(e&&e.parameter)||{},token=/^[a-f0-9]{40}$/.test(p.replyToken||'')?p.replyToken:'';
  let result={type:'life-pdf-receipt',token:token,ok:false};
  let lock;
  try {
    if(!token) throw new Error('제출 요청을 다시 시도해 주세요.');
    const input=validate_(p);
    lock=LockService.getScriptLock();
    if(!lock.tryLock(25000)) throw new Error('다른 제출을 처리 중이에요. 잠시 후 다시 눌러 주세요.');
    const props=PropertiesService.getScriptProperties(),previous=props.getProperty(input.key);
    let file=null;
    if(previous){try{const old=Drive.Files.get(previous,{fields:'id,name,trashed'});if(!old.trashed)file=old;}catch(ignore){}}
    if(!file){
      file=Drive.Files.create({name:input.name,mimeType:'application/pdf',parents:[SETTINGS.folderId]},Utilities.newBlob(input.bytes,'application/pdf',input.name),{fields:'id,name'});
      // Store the receipt immediately: retries must never silently create duplicates.
      props.setProperty(input.key,file.id);
    }
    result.ok=true;result.fileId=file.id;result.fileName=file.name;
  } catch(err) {
    const message=String(err.message||'');
    result.message=/주세요|아니에요|않아요|중이에요/.test(message)?message:'저장하지 못했어요. PDF를 내려받아 보관하고 선생님께 알려 주세요.';
  } finally {if(lock&&lock.hasLock())lock.releaseLock();}
  // HtmlService is nested by Google; send to the top-level GitHub origin only.
  const json=JSON.stringify(result).replace(/</g,'\\u003c');
  const html='<html><body><p>PDF 제출 처리 결과를 수업 화면에 전달했습니다.</p><script>window.top.postMessage('+json+','+JSON.stringify(SETTINGS.origin)+');</'+'script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doGet(){return HtmlService.createHtmlOutput('생애주기 금융 설계 PDF 제출 전용입니다. 수업 사이트의 제출 버튼을 사용하세요.');}
