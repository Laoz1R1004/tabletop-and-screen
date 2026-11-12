const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function describeFilter(f) {
  if(f.field==='players') return '支持 '+f.value+' 人';
  if(f.field==='owned') return f.value===true || f.value?.[0]===true ? '已购入' : '未购入';
  if(f.field==='rated') return f.value===true || f.value?.[0]===true ? '已评分' : '未评分';
  if(f.field==='hasExpansions') return f.value===true || f.value?.[0]===true ? '有扩展' : '无扩展';
  if(f.operator==='empty') return '未填写';
  if(f.operator==='filled') return '已填写';
  if(f.operator==='between') return f.value.join(' – ');
  if(f.operator==='gte') return '≥ '+f.value;
  if(f.operator==='lte') return '≤ '+f.value;
  if(f.operator==='all') return '全部包含：'+f.value.join('、');
  return Array.isArray(f.value) ? f.value.join(' / ') : String(f.value ?? '');
}

export function mountFacets({fields,getView,getGames,count,apply,open,close,guard=()=>false}) {
  const $=s=>document.querySelector(s);
  let filters=[], textQuery={};
  const root=$('#filterRows').cloneNode(false);
  $('#filterRows').replaceWith(root);
  $('#addFilterButton').hidden=true;
  $('#filterTitle').nextElementSibling.textContent='同类任选其一，不同条件同时满足；数量不限';
  root.className='facet-panel';
  const button=$('#applyFiltersButton');
  const current=key=>filters.find(f=>f.field===key);
  const set=(key,f)=>{filters=filters.filter(x=>x.field!==key);if(f)filters.push({field:key,...f});preview();};
  function preview(){
    const error=$('#facetError');if(error)error.textContent='';
    try {button.textContent='查看 '+count(filters)+' 件';button.disabled=false;}
    catch(e){button.textContent='请调整范围';button.disabled=true;if(error)error.textContent=e.message;}
  }
  function section(field) {
    const f=current(field.key), isEmpty=f?.operator==='empty';
    const selected=f && ['eq','in','any','all'].includes(f.operator) ? [].concat(f.value) : [];
    let control='';
    if(field.type==='number' || field.type==='players'){
      const low=f?.operator==='gte'?f.value:f?.operator==='between'?f.value[0]:'';
      const high=f?.operator==='lte'?f.value:f?.operator==='between'?f.value[1]:'';
      control=field.type==='players'
        ? '<label>今天几个人<input data-number="people" type="number" min="1" step="1" placeholder="不限" value="'+esc(f?.value ?? '')+'"></label>'
        : '<div class="facet-range"><label>最低<input data-number="low" type="number" min="0" step="any" placeholder="不限" value="'+esc(low)+'"></label><span>—</span><label>最高<input data-number="high" type="number" min="0" step="any" placeholder="不限" value="'+esc(high)+'"></label></div>';
    } else if(field.type==='text'){
      control='<label>包含文字<input data-text type="search" placeholder="输入关键词" value="'+esc(f?.operator==='contains'?f.value:'')+'"></label>';
    } else {
      const values=[...new Set(field.values ? field.values() : getGames().flatMap(g=>[].concat(g[field.key] || [])))].filter(v=>v!=='' && v!==undefined && v!==null);
      const choices=field.type==='bool'?[true,false]:values;
      if(choices.length>8)control+='<input data-option-search type="search" aria-label="搜索'+esc(field.label)+'选项" placeholder="搜索'+esc(field.label)+'" value="'+esc(textQuery[field.key] || '')+'">';
      control+='<div class="facet-choices">'+choices.map(v=>'<button type="button" class="option-chip" data-choice="'+esc(JSON.stringify(v))+'" aria-pressed="'+selected.includes(v)+'" '+(textQuery[field.key]&&!String(v).toLowerCase().includes(textQuery[field.key].toLowerCase())?'hidden':'')+'>'+esc(field.type==='bool'?(v?(field.yes || '是'):(field.no || '否')):v)+'</button>').join('')+'</div>';
      if(!choices.length)control+='<small>收藏中暂无此类标签</small>';
    }
    return '<section class="facet-section" data-facet="'+field.key+'"><div class="facet-heading"><h3>'+esc(field.label)+'</h3><button type="button" class="facet-reset" data-reset>不限</button></div>'+control+(field.type!=='bool'&&field.type!=='players'?'<button type="button" class="option-chip facet-empty" data-empty aria-pressed="'+isEmpty+'">未填写</button>':'')+'</section>';
  }
  function draw(){
    const collection=current('itemType')?.value;
    const collectionOnly=Array.isArray(collection)?collection.length===1&&collection[0]==='收藏类':collection==='收藏类';
    const visible=fields.filter(f=>!collectionOnly || !f.boardOnly);
    const common=visible.filter(f=>!f.more), more=visible.filter(f=>f.more);
    root.innerHTML=common.map(section).join('')+'<details class="facet-more"><summary>更多条件'+(more.some(f=>current(f.key))?' · 已选择':'')+'</summary>'+more.map(section).join('')+'</details><p id="facetError" role="status"></p>';
    preview();
  }
  root.onclick=e=>{
    const section=e.target.closest('[data-facet]');if(!section)return;
    const key=section.dataset.facet, field=fields.find(f=>f.key===key), f=current(key);
    if(e.target.closest('[data-reset]'))set(key,null);
    else if(e.target.closest('[data-empty]'))set(key,f?.operator==='empty'?null:{operator:'empty',value:null});
    else if(e.target.closest('[data-choice]')){
      const value=JSON.parse(e.target.closest('[data-choice]').dataset.choice);
      let values=f && ['eq','in','any','all'].includes(f.operator)?[].concat(f.value):[];
      values=values.includes(value)?values.filter(v=>v!==value):[...values,value];
      if(field.type==='bool')values=values.includes(value)?[value]:[];
      set(key,values.length?{operator:field.type==='multi'?'any':'in',value:values}:null);
      if(key==='itemType' && values.length===1 && values[0]==='收藏类')filters=filters.filter(f=>!fields.find(d=>d.key===f.field)?.boardOnly);
    }else return;
    draw();
    e.stopPropagation();
  };
  root.oninput=e=>{
    const section=e.target.closest('[data-facet]');if(!section)return;
    const key=section.dataset.facet;
    if(e.target.matches('[data-option-search]')){
      textQuery[key]=e.target.value;section.querySelectorAll('[data-choice]').forEach(b=>b.hidden=!String(JSON.parse(b.dataset.choice)).toLowerCase().includes(e.target.value.toLowerCase()));return;
    }
    if(e.target.matches('[data-text]'))set(key,e.target.value.trim()?{operator:'contains',value:e.target.value.trim()}:null);
    if(e.target.matches('[data-number]')){
      const people=section.querySelector('[data-number="people"]');
      if(people){set(key,people.value?{operator:'supports',value:Number(people.value)}:null);return;}
      const low=section.querySelector('[data-number="low"]').value,high=section.querySelector('[data-number="high"]').value;
      set(key,low!==''&&high!==''?{operator:'between',value:[Number(low),Number(high)]}:low!==''?{operator:'gte',value:Number(low)}:high!==''?{operator:'lte',value:Number(high)}:null);
    }
  };
  $('#filterButton').onclick=()=>{if(guard())return;filters=structuredClone(getView().filters);textQuery={};draw();open();};
  $('#clearFiltersButton').onclick=()=>{filters=[];draw();};
  button.onclick=async()=>{try{count(filters);await apply(filters);close();}catch(e){$('#facetError').textContent=e.message;}};
}
