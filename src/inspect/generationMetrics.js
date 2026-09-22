/* Mesures CPU opt-in, sans journal par image ni conservation illimitée. */
export class GenerationMetrics {
  constructor() { this.enabled=false;this.values=new Map(); }
  watch(object,method,label) {
    const original=object?.[method];
    if(typeof original!=='function')return;
    const metrics=this;
    object[method]=function(...args) {
      if(!metrics.enabled)return original.apply(this,args);
      const start=performance.now();
      try{return original.apply(this,args);}finally{
        const ms=performance.now()-start;
        const v=metrics.values.get(label)??{calls:0,totalMs:0,maxMs:0,lastMs:0};
        v.calls++;v.totalMs+=ms;v.maxMs=Math.max(v.maxMs,ms);v.lastMs=ms;metrics.values.set(label,v);
      }
    };
  }
  snapshot() {return Object.fromEntries([...this.values].map(([k,v])=>[k,{...v,meanMs:v.totalMs/v.calls}]));}
  reset() {this.values.clear();}
}
