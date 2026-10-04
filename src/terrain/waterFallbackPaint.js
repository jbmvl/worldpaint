/* Rasterise seulement les objets explicitement en repli. La carte reste
 * sous-jacente aux surfaces résolues, y compris après une protection locale. */
export function paintWaterFallbacks(ctx,objects,frame,originX,originZ,perMeter,fill,waterways) {
  ctx.save();ctx.strokeStyle=ctx.fillStyle=fill;ctx.lineCap='round';ctx.lineJoin='round';
  let painted=0;
  for(const object of objects) {
    const path=new Path2D();
    if(object.rings) {
      for(const ring of object.rings) {for(let i=0;i<ring.length;i++){const p=frame.toLocal(...ring[i]),x=(p.x-originX)*perMeter,z=(p.z-originZ)*perMeter;if(i===0)path.moveTo(x,z);else path.lineTo(x,z);}path.closePath();}
      ctx.fill(path,'evenodd');painted++;
    } else {
      for(let i=0;i<object.points.length;i++){const p=object.points[i],x=(p.x-originX)*perMeter,z=(p.z-originZ)*perMeter;if(i===0)path.moveTo(x,z);else path.lineTo(x,z);}
      ctx.lineWidth=waterways[object.kind]*perMeter;ctx.stroke(path);painted++;
    }
  }
  ctx.restore();return painted;
}
