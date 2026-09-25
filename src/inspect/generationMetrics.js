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
        metrics.record(label, ms);
      }
    };
  }
  record(label, ms) {
    if (!this.enabled) return;
    const value = this.values.get(label) ?? { calls: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
    value.calls++; value.totalMs += ms; value.maxMs = Math.max(value.maxMs, ms); value.lastMs = ms;
    this.values.set(label, value);
  }
  snapshot() {return Object.fromEntries([...this.values].map(([k,v])=>[k,{...v,meanMs:v.totalMs/v.calls}]));}
  reset() {this.values.clear();}
}
