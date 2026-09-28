// Gerador de PDF mínimo, sem dependências: A4, Helvetica/Helvetica-Bold (fontes padrão), WinAnsi.
const A4={w:595.28,h:841.89}
const HELV=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const HELVB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
const CP1252={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159}
const REPLACE={'→':'->','←':'<-','≈':'~','×':'x','−':'-','≤':'<=','≥':'>=','↑':'^','↓':'v','▲':'^','▼':'v','✓':'ok',' ':' '}
export function toWinAnsi(input){
 let out='';for(const ch of String(input??'')){const code=ch.codePointAt(0);if(code<128||(code>=160&&code<256))out+=ch;else if(CP1252[ch]!==undefined)out+=String.fromCharCode(CP1252[ch]);else if(REPLACE[ch]!==undefined)out+=REPLACE[ch];else{const base=ch.normalize('NFD').replace(/[̀-ͯ]/g,'');out+=base&&base.codePointAt(0)<256?base:'?'}}
 return out
}
const escapePdf=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/\r/g,'').replace(/\n/g,' ')
export function textWidth(str,size=10,bold=false){
 const table=bold?HELVB:HELV;let w=0
 for(const ch of toWinAnsi(str)){const c=ch.charCodeAt(0);w+=c>=32&&c<=126?table[c-32]:c===160?278:556}
 return w*size/1000
}
const fmtNum=n=>Number(n).toFixed(2)
const hex=c=>{const m=String(c||'#000000').replace('#','');const r=parseInt(m.slice(0,2),16)/255,g=parseInt(m.slice(2,4),16)/255,b=parseInt(m.slice(4,6),16)/255;return `${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)}`}

export function createPdf({title='Relatório',author='VAL-SOG',margin=40}={}){
 const pages=[];let current=null
 const W=A4.w,H=A4.h
 const addPage=()=>{current={ops:[]};pages.push(current);return current}
 const op=s=>current.ops.push(s)
 const doc={
  W,H,margin,pageCount:()=>pages.length,
  addPage(){addPage();return doc},
  eachPage(fn){const keep=current;pages.forEach((p,i)=>{current=p;fn(i+1,pages.length)});current=keep;return doc},
  text(x,y,str,{size=10,bold=false,color='#111111',align='left',maxWidth=null}={}){
   let s=String(str??'');if(maxWidth!=null){while(s.length>1&&textWidth(s,size,bold)>maxWidth)s=s.slice(0,-1);if(s!==String(str??'')&&s.length>2)s=s.slice(0,-1)+'…'}
   const w=textWidth(s,size,bold);let px=x;if(align==='right')px=x-w;else if(align==='center')px=x-w/2
   op(`BT /${bold?'F2':'F1'} ${size} Tf ${hex(color)} rg ${fmtNum(px)} ${fmtNum(H-y)} Td (${escapePdf(toWinAnsi(s))}) Tj ET`);return w
  },
  wrap(x,y,str,{size=10,bold=false,color='#111111',width=200,lineHeight=null}={}){
   const lh=lineHeight||size*1.35;const words=String(str??'').split(/\s+/);const lines=[];let line=''
   for(const w of words){const t=line?line+' '+w:w;if(textWidth(t,size,bold)>width&&line){lines.push(line);line=w}else line=t}
   if(line)lines.push(line);lines.forEach((l,i)=>doc.text(x,y+i*lh,l,{size,bold,color}));return y+lines.length*lh
  },
  line(x1,y1,x2,y2,{width=0.6,color='#CCCCCC'}={}){op(`${hex(color)} RG ${fmtNum(width)} w ${fmtNum(x1)} ${fmtNum(H-y1)} m ${fmtNum(x2)} ${fmtNum(H-y2)} l S`)},
  rect(x,y,w,h,{fill=null,stroke=null,width=0.6}={}){const parts=[];if(fill)parts.push(`${hex(fill)} rg`);if(stroke)parts.push(`${hex(stroke)} RG ${fmtNum(width)} w`);parts.push(`${fmtNum(x)} ${fmtNum(H-y-h)} ${fmtNum(w)} ${fmtNum(h)} re ${fill&&stroke?'B':fill?'f':'S'}`);op(parts.join(' '))},
  render(){
   const objects=[];const add=body=>{objects.push(body);return objects.length}
   const fontRegular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
   const fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
   const pagesId=objects.length+1+pages.length*2
   const pageIds=[]
   for(const page of pages){
    const content=page.ops.join('\n');const len=Buffer.byteLength(content,'latin1')
    const contentId=add(`<< /Length ${len} >>\nstream\n${content}\nendstream`)
    const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmtNum(W)} ${fmtNum(H)}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
   }
   const realPagesId=add(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
   if(realPagesId!==pagesId)throw new Error('Estrutura de páginas inconsistente.')
   const catalogId=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
   const esc=s=>escapePdf(toWinAnsi(s))
   const now=new Date();const d=`D:${now.toISOString().replace(/[-:T]/g,'').slice(0,14)}Z`
   const infoId=add(`<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (VAL-SOG) /CreationDate (${d}) >>`)
   let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[]
   objects.forEach((body,i)=>{offsets.push(Buffer.byteLength(out,'latin1'));out+=`${i+1} 0 obj\n${body}\nendobj\n`})
   const xref=Buffer.byteLength(out,'latin1')
   out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')
   out+=`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
   return Buffer.from(out,'latin1')
  }
 }
 return doc
}

// Tabela com quebra de página automática. columns: [{key,label,width,align}]; rows: objetos; opções: header/footer por página.
export function drawTable(doc,{columns,rows,x,y,rowHeight=16,headerHeight=18,fontSize=8.5,zebra='#F3F6FA',headerFill='#0758B6',headerColor='#FFFFFF',onNewPage=null,bottom=null,maxRowLines=1}){
 const limit=bottom||doc.H-doc.margin-24
 const totalWidth=columns.reduce((s,c)=>s+c.width,0)
 const header=()=>{doc.rect(x,y,totalWidth,headerHeight,{fill:headerFill});let cx=x;for(const c of columns){const tx=c.align==='right'?cx+c.width-4:cx+4;doc.text(tx,y+headerHeight-5.5,c.label,{size:fontSize,bold:true,color:headerColor,align:c.align==='right'?'right':'left',maxWidth:c.width-8});cx+=c.width}y+=headerHeight}
 header()
 rows.forEach((row,i)=>{
  if(y+rowHeight>limit){doc.addPage();y=doc.margin;if(onNewPage)y=onNewPage(doc)||y;header()}
  if(zebra&&i%2===1)doc.rect(x,y,totalWidth,rowHeight,{fill:zebra})
  let cx=x;for(const c of columns){const raw=typeof c.value==='function'?c.value(row):row[c.key];const val=raw==null||raw===''?'—':String(raw);const tx=c.align==='right'?cx+c.width-4:cx+4;doc.text(tx,y+rowHeight-4.5,val,{size:fontSize,bold:Boolean(c.bold),color:c.color?c.color(row):'#1B2A3A',align:c.align==='right'?'right':'left',maxWidth:c.width-8});cx+=c.width}
  doc.line(x,y+rowHeight,x+totalWidth,y+rowHeight,{color:'#E3E9F1',width:0.4});y+=rowHeight
 })
 return y
}
