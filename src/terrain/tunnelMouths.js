/* Ouverture locale du terrain devant les portails. La colline au-dessus
 * de la voûte reste intacte ; le masque ne découpe que le gabarit intérieur.
 *
 * Les bouches passent par une petite texture flottante (une ligne par bouche,
 * trois texels : origine, axe, toit et tablier), pas par des tableaux
 * d'uniformes : ceux-ci coûtaient 96 vecteurs au fragment shader du sol, que
 * les GPU Adreno plafonnent à 256 lumières de three.js comprises — au-delà, le
 * programme ne se lie pas et le sol disparaît.
 */
const MAX_MOUTHS=24;
const TEXELS=3;
export function installTunnelMouths(THREE, material) {
  const data=new Float32Array(TEXELS*MAX_MOUTHS*4);
  const texture=new THREE.DataTexture(data,TEXELS,MAX_MOUTHS,THREE.RGBAFormat,THREE.FloatType);
  texture.magFilter=THREE.NearestFilter;
  texture.minFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;
  texture.needsUpdate=true;
  const mouthsMap={value:texture};
  const count={value:0};
  const compile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    compile(shader);
    Object.assign(shader.uniforms,{uTunnelMouths:mouthsMap,uTunnelCount:count});
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D uTunnelMouths;
      uniform int uTunnelCount;`)
      .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      for(int i=0;i<${MAX_MOUTHS};i++) {
        if(i>=uTunnelCount) break;
        vec4 origin=texelFetch(uTunnelMouths,ivec2(0,i),0);
        vec4 axis=texelFetch(uTunnelMouths,ivec2(1,i),0);
        vec2 extra=texelFetch(uTunnelMouths,ivec2(2,i),0).xy;
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
        if(extra.x>0.0) roof=extra.x;
        if(along>-extra.y && along<18.0 && across<origin.w && height>0.02 && height<roof) discard;
      }`);
  };
  const key=material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey=()=>`${key()}-tunnel-mouths-v3`;
  const setMouths=mouths=>{
    count.value=Math.min(MAX_MOUTHS,mouths.length);
    for(let i=0;i<count.value;i++) {
      const m=mouths[i];
      data.set([m.x,m.y,m.z,m.radius, m.dx,m.dz,m.slope,m.steps ?? 7, m.roofHeight??0,m.apron??6,0,0],i*TEXELS*4);
    }
    texture.needsUpdate=true;
  };
  setMouths.texture=texture;
  return setMouths;
}
