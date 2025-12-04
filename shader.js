
const canvas = document.getElementById('bg-canvas');
const gl = canvas.getContext('webgl');
if (!gl) {
    console.error('WebGL not supported');
    }

// Resize canvas to fill window (and handle DPI)
function resize() {
        const dpr = window.devicePixelRatio || 1;
const w = window.innerWidth;
const h = window.innerHeight;
canvas.width = w * dpr;
canvas.height = h * dpr;
canvas.style.width = w + 'px';
canvas.style.height = h + 'px';
gl.viewport(0, 0, canvas.width, canvas.height);
    }
window.addEventListener('resize', resize);
resize();

const vertexSrc = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
gl_Position = vec4(a_position, 0.0, 1.0);
        }
`;

// Fragment shader: subtle animated fBm-style noise for soft shadows
const fragmentSrc = `
precision mediump float;
varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;

// Simple hash
float hash(vec2 p) {
	p = fract(p * vec2(123.34, 345.45));
	p += dot(p, p + 34.345);
	return fract(p.x * p.y);
}

// Smooth value noise
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);

	vec2 u = f * f * (3.0 - 2.0 * f);

	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));

	return mix(
		mix(a, b, u.x),
		mix(c, d, u.x),
		u.y
	);
}

// Small fBm: 3 octaves
float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 3; i++) {
		v += a * noise(p);
		p *= 2.0;
		a *= 0.5;
	}
	return v;
}

void main() {
	vec2 uv = v_uv;
	vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
	vec2 p = (uv - 0.5) * aspect;

	// Base: dark neutral gray
	vec3 baseColor = vec3(0.08, 0.09, 0.10);

	// --- Large-scale shapes: mostly static ---
	// Very slow time factor
	float t = u_time * 0.004;  // was ~0.03
	vec2 q = p * 2.0;
	// Tiny time influence so it "breathes" but doesn't drift much
	float n = fbm(q + vec2(t * 0.7, -t * 0.5));

	// Soft vignette
	float r = length(p);
	float vignette = smoothstep(0.9, 0.3, r);

	float largeScaleIntensity = n * 0.35 + vignette * 0.4;

	// --- Fine sand / pixel grain ---
	float grainGrid = 900.0; // grain resolution: 400–1200
	vec2 gUV = floor(uv * grainGrid) / grainGrid;

	// Static grain (no crawling)
	float staticGrain = hash(gUV);

	// "Breeze" field: low-frequency mask that moves slowly
	// This modulates how visible the grain is in different patches.
	float breeze = fbm(uv * 3.0 + vec2(u_time * 0.02, -u_time * 0.015));
	// Shape it to be soft and biased toward subtle changes
	breeze = smoothstep(0.2, 0.8, breeze);

	// Grain centered around 0, scaled by slow-moving breeze
	float grainAmount = (staticGrain - 0.5) * 0.16 * (0.4 + 0.6 * breeze);

	// Slight color tilt (cool shadows)
	vec3 tint = vec3(0.0, 0.12, 0.20);
	vec3 color = baseColor + tint * largeScaleIntensity;

	// Apply grain mostly to brightness
	color += grainAmount;

	color = clamp(color, 0.0, 1.0);
	gl_FragColor = vec4(color, 1.0);
}
`;



function createShader(type, source) {
        const shader = gl.createShader(type);
gl.shaderSource(shader, source);
gl.compileShader(shader);
if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
gl.deleteShader(shader);
return null;
        }
return shader;
    }

const vs = createShader(gl.VERTEX_SHADER, vertexSrc);
const fs = createShader(gl.FRAGMENT_SHADER, fragmentSrc);

const program = gl.createProgram();
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    }

gl.useProgram(program);

// Fullscreen quad
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = new Float32Array([
-1, -1,
1, -1,
-1,  1,
-1,  1,
1, -1,
1,  1
]);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const aPositionLocation = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(aPositionLocation);
gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

const uResolution = gl.getUniformLocation(program, 'u_resolution');
const uTime = gl.getUniformLocation(program, 'u_time');

let startTime = performance.now();

function render() {
        const now = performance.now();
const t = (now - startTime) / 1000.0;

gl.uniform2f(uResolution, canvas.width, canvas.height);
gl.uniform1f(uTime, t);

gl.drawArrays(gl.TRIANGLES, 0, 6);

requestAnimationFrame(render);
    }
render();
