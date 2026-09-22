/* Ouverture locale du terrain devant les portails. La colline au-dessus
 * de la voûte reste intacte ; le masque ne découpe que le gabarit intérieur.
 */
const MAX_MOUTHS=24;
export function installTunnelMouths(THREE, material) {
  const origins={value:Array.from({length:MAX_MOUTHS},()=>new THREE.Vector4())};
  const directions={value:Array.from({length:MAX_MOUTHS},()=>new THREE.Vector4())};
  const count={value:0};
  const compile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    compile(shader);
    Object.assign(shader.uniforms,{uTunnelOrigins:origins,uTunnelDirections:directions,uTunnelCount:count});
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform vec4 uTunnelOrigins[${MAX_MOUTHS}];
      uniform vec4 uTunnelDirections[${MAX_MOUTHS}];
      uniform int uTunnelCount;`)
      .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      for(int i=0;i<${MAX_MOUTHS};i++) {
        if(i>=uTunnelCount) break;
        vec4 origin=uTunnelOrigins[i];vec4 axis=uTunnelDirections[i];
        vec2 delta=vScenePos.xz-origin.xz;
        float along=dot(delta,axis.xy);
        float lateral=dot(delta,vec2(-axis.y,axis.x));
        float across=abs(lateral);
        float height=vScenePos.y-origin.y-along*axis.z;
        float stepAngle=PI/max(1.0,axis.w);
        float angle=acos(clamp(lateral/origin.w,-1.0,1.0));
        float a=min(floor(angle/stepAngle),axis.w-1.0)*stepAngle;
        vec2 left=vec2(cos(a),sin(a))*origin.w;
        vec2 right=vec2(cos(a+stepAngle),sin(a+stepAngle))*origin.w;
        float roof=1.0+0.85*mix(left.y,right.y,clamp((lateral-left.x)/(right.x-left.x),0.0,1.0));
        if(along>-6.0 && along<18.0 && across<origin.w && height>-.2 && height<roof) discard;
      }`);
  };
  const key=material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey=()=>`${key()}-tunnel-mouths-v1`;
  return mouths=>{
    count.value=Math.min(MAX_MOUTHS,mouths.length);
    for(let i=0;i<count.value;i++) {
      const m=mouths[i];origins.value[i].set(m.x,m.y,m.z,m.radius);
      directions.value[i].set(m.dx,m.dz,m.slope,m.steps ?? 7);
    }
  };
}
