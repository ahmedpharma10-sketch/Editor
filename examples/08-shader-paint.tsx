/* @jsxImportSource @diffusionstudio/jsx */
/* A shader paint post-processing a video: chromatic aberration pulsing with
 * the playhead plus a vignette, driven by two uniforms.
 *
 *   dapi mount examples/08-shader-paint.tsx
 *
 * <shaderPaint> applies its WGSL to the media paint directly below it in the
 * paint stack (here: the paint created by the video's `src`). The engine
 * provides `sampleSource(uv)` (box-space sampling that honors objectFit),
 * `globals.time` (the clip's local time in seconds, playhead-driven, so
 * scrubbing and exports stay frame-accurate), and binds the `uniforms` prop
 * to the shader's @group(1) declarations by name. Patch them live:
 *
 *   dapi node patch '[{ "id": <paintId>, "uniforms": { "strength": 3, "vignette": 0.8 } }]'
 */

const VIDEOS = "https://mdn.github.io/shared-assets/videos";

const ABERRATION = /* wgsl */ `
  @group(1) @binding(0) var<uniform> strength: f32;
  @group(1) @binding(1) var<uniform> vignette: f32;

  @fragment
  fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let center = uv - vec2f(0.5);
    let pulse = strength * (0.6 + 0.4 * sin(globals.time * 2.0));
    let shift = center * pulse * 0.01;

    let r = sampleSource(uv + shift).r;
    let ga = sampleSource(uv);
    let b = sampleSource(uv - shift).b;

    let falloff = 1.0 - vignette * smoothstep(0.3, 0.75, length(center));
    return vec4f(vec3f(r, ga.g, b) * falloff, ga.a);
  }
`;

export default function ShaderPaintExample() {
  return (
    <scene key="example-shader-paint" name="Shader paint" width={1920} height={1080} fill="#000000">
      <video src={`${VIDEOS}/sintel-short.mp4`} width={1920} height={1080}>
        <shaderPaint wgsl={ABERRATION} uniforms={{ strength: 1.5, vignette: 0.6 }} />
      </video>
    </scene>
  );
}
