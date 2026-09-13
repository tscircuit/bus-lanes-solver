import {useState,useEffect} from 'react';
import {GenericSolverDebugger} from '@tscircuit/solver-utils/react';
import {BusLanesSolver,type SimpleRouteJson} from '../lib';
export function FixtureView({input,title,description}:{input:SimpleRouteJson;title:string;description:string}){
 const [step,setStep]=useState(0.1);
 return <main style={{fontFamily:'system-ui',padding:20,color:'#0f172a'}}><header style={{borderBottom:'1px solid #cbd5e1',paddingBottom:16,marginBottom:16}}><small style={{letterSpacing:2}}>TSCIRCUIT / BUS LANES</small><h1>{title}</h1><p style={{maxWidth:1000,lineHeight:1.6}}>{description}</p><p>Blue: source terminals · Amber: fixed destinations · Cyan: search frontier · Pink: current candidate · Colored lines: committed lanes</p><label>Grid resolution <select value={step} onChange={e=>setStep(Number(e.target.value))}><option value={0.1}>0.10 mm</option><option value={0.05}>0.05 mm</option><option value={0.025}>0.025 mm</option></select></label></header><GenericSolverDebugger key={step} createSolver={()=>new BusLanesSolver(input,{gridStep:step,maxSearchIterations:100000})}/></main>
}

export function FixtureLoader({url,title,description}:{url:string;title:string;description:string}){const [input,setInput]=useState<SimpleRouteJson>();const [error,setError]=useState('');useEffect(()=>{fetch(url).then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}).then(setInput).catch(e=>setError(String(e)))},[url]);return input?<FixtureView input={input} title={title} description={description}/>:<p>{error||'Loading captured routing problem…'}</p>}
