/* Eau opaque éclairée et embrumée comme le paysage. La normale R/G/B de la
 * texture est reconstruite dans le plan x/z ; Fresnel et Lambert utilisent
 * exactement cette perturbation. Le temps appartient à la couche, pas au lot. */
import {createWaterNormalCanvas} from './proceduralTextures.js';
export const WATER_PROFILE_DEFAULTS={scaleAlong:8,scaleAcross:3,normalStrength:0.12,speed:0.4,amplitudeM:0,foamWidthM:0,foamSlope:0.015,wavelengths:[48,72]};
export function createWaterMaterial(THREE,{kind,theme,texture,time,geoOrigin,geoScale=1,verticalScale=1}) {
  const look={...WATER_PROFILE_DEFAULTS,...theme.water?.profiles?.[kind]},terrain=theme.terrain;
  const material=new THREE.MeshLambertMaterial({color:0xffffff,transparent:false,depthTest:true,depthWrite:true,side:THREE.DoubleSide});
  const modulo=v=>((v%1)+1)%1,phase=v=>v%(Math.PI*2);
  const normalOrigin=[modulo(geoOrigin[0]/look.scaleAcross),modulo(geoOrigin[1]/look.scaleAlong)];
  const normalOrigin2=[modulo(geoOrigin[1]/look.scaleAlong*.67),modulo(geoOrigin[0]/look.scaleAcross*.67)];
  const wavePhase=[phase((geoOrigin[0]*.8+geoOrigin[1]*.6)*Math.PI*2/look.wavelengths[0]),phase((-geoOrigin[0]*.4+geoOrigin[1]*.9)/Math.hypot(.4,.9)*Math.PI*2/look.wavelengths[1])];
  const uniforms={uWaterTime:time,uWaterNormal:{value:texture},uWaterOrigin:{value:new THREE.Vector2(...normalOrigin)},uWaterOrigin2:{value:new THREE.Vector2(...normalOrigin2)},uWaterGeoScale:{value:geoScale},uWaterWavePhase:{value:new THREE.Vector2(...wavePhase)},uWaterScales:{value:new THREE.Vector2(look.scaleAcross,look.scaleAlong)},uWaterStrength:{value:look.normalStrength},uWaterSpeed:{value:look.speed},uWaterAmplitude:{value:kind==='ocean'?look.amplitudeM*verticalScale:0},uWaterWavelengths:{value:new THREE.Vector2(...look.wavelengths)},uWaterColor:{value:new THREE.Vector3(...theme.surfaces.water.albedo)},uWaterSheenColor:{value:new THREE.Vector3(...terrain.waterSheenColor)},uWaterSheen:{value:terrain.waterSheen},uWaterFoamColor:{value:new THREE.Vector3(...(theme.water?.foamColor??terrain.waterSheenColor))},uWaterFoam:{value:look.foamWidthM>0?1:0}};
  material.onBeforeCompile=shader=> {
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute float alongM, acrossM, flowKnown, waveWeight, foamAcross, shoreM, phaseBlendM;
      attribute vec2 flow;
      varying vec3 vWaterPosition;
      varying vec4 vWaterFlow;
      varying vec4 vWaterBand;
      uniform float uWaterTime, uWaterAmplitude, uWaterGeoScale;
      uniform vec2 uWaterWavePhase, uWaterWavelengths;
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec2 geo = position.xz * uWaterGeoScale;
      float wave = sin(dot(geo,normalize(vec2(0.8,0.6)))*6.2831853/uWaterWavelengths.x+uWaterWavePhase.x-uWaterTime*0.7)
                 + 0.5*sin(dot(geo,normalize(vec2(-0.4,0.9)))*6.2831853/uWaterWavelengths.y+uWaterWavePhase.y-uWaterTime*0.9);
      transformed.y += wave*uWaterAmplitude*waveWeight;
      vWaterPosition = (modelMatrix*vec4(transformed,1.0)).xyz;
      vWaterFlow = vec4(acrossM,alongM,flowKnown,phaseBlendM);
      vWaterBand = vec4(foamAcross,shoreM,flow);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D uWaterNormal;
      uniform float uWaterTime, uWaterStrength, uWaterSpeed, uWaterSheen, uWaterFoam;
      uniform vec2 uWaterOrigin, uWaterOrigin2, uWaterScales;
      uniform float uWaterGeoScale;
      uniform vec3 uWaterColor, uWaterSheenColor, uWaterFoamColor;
      varying vec3 vWaterPosition;
      varying vec4 vWaterFlow, vWaterBand;
      vec3 waterNormal() {
        vec2 localUv = vWaterPosition.xz*uWaterGeoScale/uWaterScales;
        vec2 world = localUv+uWaterOrigin;
        vec2 uv = ${['river','stream','canal','drain','ditch'].includes(kind)?'vec2(vWaterFlow.x/uWaterScales.x,(vWaterFlow.y-uWaterSpeed*uWaterTime*vWaterFlow.z)/uWaterScales.y)':'world + vec2(uWaterTime*0.008,-uWaterTime*0.005)'};
        vec3 a = texture2D(uWaterNormal,uv).xyz*2.0-1.0;
        vec3 b = texture2D(uWaterNormal,${['river','stream','canal','drain','ditch'].includes(kind)?'uv.yx*0.67':'localUv.yx*0.67+uWaterOrigin2'}+vec2(-uWaterTime*0.004,uWaterTime*0.006)).xyz*2.0-1.0;
        vec2 slopes = (a.xy+b.yx)*uWaterStrength;
        ${['river','stream','canal','drain','ditch'].includes(kind)?`vec2 tangent = normalize(vWaterBand.zw+vec2(1e-8));
        slopes = vec2(tangent.y,-tangent.x)*slopes.x+tangent*slopes.y;
        vec3 stableRipple = texture2D(uWaterNormal,world+vec2(uWaterTime*0.006)).xyz*2.0-1.0;
        slopes = mix(stableRipple.xy*uWaterStrength,slopes,smoothstep(0.0,8.0,vWaterFlow.w));`:''}
        return normalize(vec3(slopes.x,max(0.05,(a.z+b.z)*0.5),slopes.y));
      }
    `).replace('#include <color_fragment>',`#include <color_fragment>
      vec3 perturbation = waterNormal();
      vec3 eye = normalize(cameraPosition-vWaterPosition);
      float fresnel = pow(1.0-clamp(dot(perturbation,eye),0.0,1.0),3.0)*uWaterSheen;
      vec3 water = mix(uWaterColor,uWaterSheenColor,clamp(fresnel,0.0,1.0));
      float noise = texture2D(uWaterNormal,vec2(vWaterBand.y*0.12-uWaterTime*0.03,vWaterBand.x)).r;
      float foam = (1.0-smoothstep(0.0,1.0,vWaterBand.x))*smoothstep(0.35,0.65,noise)*uWaterFoam;
      diffuseColor.rgb = mix(water,uWaterFoamColor,foam);
    `).replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      normal = normalize((viewMatrix*vec4(waterNormal(),0.0)).xyz);
    `);
  };
  material.customProgramCacheKey=()=>`water-opaque-v1-${kind}`;
  material.userData.waterUniforms=uniforms;
  return material;
}
export function createWaterTexture(THREE) {
  const texture=new THREE.CanvasTexture(createWaterNormalCanvas());texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;return texture;
}
