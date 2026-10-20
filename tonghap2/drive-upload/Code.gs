/**
 * 나의 생애주기 금융 설계 — PDF 수신기
 * Deploy as web app: execute as folder owner, access anyone.
 * Anonymous students upload through doPost; teacher reads require the deploying account.
 * Put this deployment's /exec URL in life.html DRIVE_UPLOAD_URL after authorization.
 */
const SETTINGS = Object.freeze({
  folderId: PropertiesService.getScriptProperties().getProperty('SUBMISSION_FOLDER_ID'),
  origin: 'https://kste200267-boop.github.io',
  passwordHash: PropertiesService.getScriptProperties().getProperty('SUBMISSION_PASSWORD_HASH'),
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
function doGet(e){if(e&&e.parameter&&e.parameter.view==='teacher')return teacherPage_();return HtmlService.createHtmlOutput('생애주기 금융 설계 PDF 제출 전용입니다. 수업 사이트의 제출 버튼을 사용하세요.');}

/* Teacher-only methods. PRIVATE_ROSTER exists only in the private Apps Script project. */
function requireTeacher_(){
 const active=Session.getActiveUser().getEmail(),owner=Session.getEffectiveUser().getEmail();
 if(!active||!owner||active.toLowerCase()!==owner.toLowerCase())throw new Error('교사 Google 계정으로 접속해 주세요. 학생용 비밀번호로는 열 수 없습니다.');
 return active;
}
function roster_(){
 if(typeof PRIVATE_ROSTER==='undefined')throw new Error('교사용 명렬이 아직 연결되지 않았습니다.');
 const rows=[];PRIVATE_ROSTER.forEach(function(names,c){names.forEach(function(name,i){if(name)rows.push({key:'1|'+c+'|'+(i+1),grade:'1',cls:SETTINGS.classes[c],number:i+1,name:name});});});return rows;
}
function normalizedName_(name){return String(name||'').normalize('NFKC').toLowerCase().replace(/[\s.'’\-]/g,'');}
function fileStudent_(name){
 const m=String(name).normalize('NFKC').match(/^([123])학년\s+(.+?)\s+(\d{1,2})번\s+(.+)\.pdf$/i);
 if(!m)return null;const c=SETTINGS.classes.indexOf(m[2]);if(c<0||+m[3]<1||+m[3]>40)return null;
 return {key:m[1]+'|'+c+'|'+Number(m[3]),name:m[4]};
}
function folderPDFs_(){
 let files=[],pageToken;do{const options={q:"'"+SETTINGS.folderId+"' in parents and trashed = false and mimeType = 'application/pdf'",pageSize:1000,fields:'nextPageToken,files(id,name,createdTime,modifiedTime,webViewLink)',orderBy:'createdTime desc'};if(pageToken)options.pageToken=pageToken;const page=Drive.Files.list(options);files=files.concat(page.files||[]);pageToken=page.nextPageToken;}while(pageToken);return files;
}
function getReviewData(){
 requireTeacher_();const rows=roster_(),props=PropertiesService.getScriptProperties(),map={};
 rows.forEach(function(r){r.aliases=JSON.parse(props.getProperty('alias_'+r.key)||'[]');r.files=[];map[r.key]=r;});
 const unmatched=[];folderPDFs_().forEach(function(f){const id=fileStudent_(f.name),r=id&&map[id.key];const file={id:f.id,fileName:f.name,created:f.createdTime||f.modifiedTime||'',enteredName:id?id.name:'',viewUrl:f.webViewLink||'https://drive.google.com/file/d/'+f.id+'/view'};
 file.review=JSON.parse(props.getProperty('review_'+f.id)||'{}');
 if(file.review.status==='excluded'){file.excluded=true;unmatched.push(file);return;}
 if(!r){unmatched.push(file);return;}
 file.nameVerified=[r.name].concat(r.aliases).some(function(n){return normalizedName_(n)===normalizedName_(file.enteredName);});r.files.push(file);
 });
 rows.forEach(function(r){r.files.sort(function(a,b){return b.created.localeCompare(a.created)||a.id.localeCompare(b.id);});});
 return {rows:rows,unmatched:unmatched,classes:SETTINGS.classes,updated:new Date().toISOString(),folderUrl:'https://drive.google.com/drive/folders/'+SETTINGS.folderId};
}
function approveStudentAlias(key,name){
 requireTeacher_();name=String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!roster_().some(function(r){return r.key===key;})||!name||name.length>80)throw new Error('학생과 이름을 확인해 주세요.');
 const present=folderPDFs_().some(function(f){const id=fileStudent_(f.name);return id&&id.key===key&&id.name===name;});if(!present)throw new Error('해당 학생의 제출 이름을 찾지 못했습니다. 새로고침해 주세요.');
 const lock=LockService.getScriptLock();lock.waitLock(10000);try{const props=PropertiesService.getScriptProperties(),aliases=JSON.parse(props.getProperty('alias_'+key)||'[]');if(!aliases.some(function(n){return normalizedName_(n)===normalizedName_(name);}))aliases.push(name);props.setProperty('alias_'+key,JSON.stringify(aliases));}finally{lock.releaseLock();}return true;
}
function teacherPage_(){
 try{requireTeacher_();return HtmlService.createHtmlOutputFromFile('Review').setTitle('생애주기 · 반별 제출 현황').addMetaTag('viewport','width=device-width, initial-scale=1');}
 catch(e){return HtmlService.createHtmlOutput('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:48px;line-height:1.8"><h1>교사용 제출 현황</h1><p>이 화면은 배포한 교사 Google 계정에서만 열 수 있습니다.</p><p>학교 계정이 아닌 제출 폴더를 연결한 계정으로 Google에 로그인한 뒤 다시 열어 주세요.</p><p>학생의 명렬과 제출물은 표시하지 않았습니다.</p><a href="https://kste200267-boop.github.io/teaching-tools/tonghap2/life.html" target="_top">수업 사이트로 돌아가기</a></body></html>');}
}

function saveReviewStatus(fileId,status,note){
 requireTeacher_();
 if(!/^[A-Za-z0-9_-]+$/.test(String(fileId))||['pending','reviewed','revise','excluded'].indexOf(status)<0)throw new Error('검토 상태를 확인해 주세요.');
 note=String(note||'').trim();if(note.length>1000)throw new Error('메모는 1000자까지 저장할 수 있습니다.');
 if(!folderPDFs_().some(function(f){return f.id===fileId;}))throw new Error('제출 폴더에서 파일을 찾지 못했습니다.');
 const value={status:status,note:note,updated:new Date().toISOString()};
 PropertiesService.getScriptProperties().setProperty('review_'+fileId,JSON.stringify(value));return true;
}
