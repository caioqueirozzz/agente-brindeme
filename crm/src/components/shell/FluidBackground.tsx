"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme";
import type { Theme } from "./theme";

type Palette = { bg: [number, number, number]; ink: [number, number, number]; amount: number };

// Claro: tinta preta, bem diluída, sobre branco. Escuro: inverte para um
// vermelho luminoso sobre vinho (mesmo fundo de --pe-background).
const PALETTES: Record<Theme, Palette> = {
  light: { bg: [1, 1, 1], ink: [0, 0, 0], amount: 0.12 },
  dark: { bg: [0.078, 0.024, 0.039], ink: [0.78, 0.1, 0.25], amount: 0.32 },
};

// O fluido é difuso: renderizar em meia resolução não muda o resultado
const RESOLUTION_SCALE = 0.5;

// Contexto perdido e não devolvido nesse prazo: troca o canvas por um novo
const CONTEXT_RESTORE_TIMEOUT_MS = 3000;
const MAX_CANVAS_RECREATIONS = 3;

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform vec3 uBackground;
uniform vec3 uInk;
uniform float uAmount;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = rotation * p * 2.02;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // O cursor arrasta o fluido no sentido do movimento e deixa um leve redemoinho
  vec2 toPointer = p - vec2(uPointer.x * aspect, uPointer.y);
  float influence = exp(-dot(toPointer, toPointer) * 7.0);
  float speed = length(uVelocity);
  p -= uVelocity * influence * 0.22;
  p += vec2(-toPointer.y, toPointer.x) * influence * speed * 0.5;

  // Domain warping: ruído deformado por ruído dá o aspecto de tinta na água
  float t = uTime * 0.035;
  vec2 q = p * 1.4;
  vec2 warpA = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3) - t));
  vec2 warpB = vec2(
    fbm(q + 2.6 * warpA + vec2(1.7, 9.2) + t * 0.8),
    fbm(q + 2.6 * warpA + vec2(8.3, 2.8) - t * 0.6)
  );
  float density = smoothstep(0.3, 0.8, fbm(q + 2.8 * warpB));
  density += influence * min(speed, 1.0) * 0.25;

  vec3 color = mix(uBackground, uInk, clamp(density, 0.0, 1.0) * uAmount);
  // Dithering: sem ele o degradê suave forma faixas visíveis
  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("FluidBackground: shader inválido", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/**
 * Fundo fluido do shell: fixo atrás do conteúdo, reage de leve ao cursor.
 * Sem WebGL (ou se o navegador perder o contexto) entra um degradê em CSS.
 * `theme` fixa a paleta (as telas de login são sempre escuras).
 */
export function FluidBackground({ theme: fixedTheme }: { theme?: Theme } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentTheme = useTheme();
  const theme = fixedTheme ?? currentTheme;
  const paletteRef = useRef<Palette>(PALETTES[theme]);
  const redrawRef = useRef<(() => void) | null>(null);
  // Trocar a key cria um <canvas> novo, com contexto novo: é a saída quando o
  // navegador perde o contexto e nunca o devolve
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    paletteRef.current = PALETTES[theme];
    redrawRef.current?.();
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const target = { x: 0.5, y: 0.5 };
    const pointer = { x: 0.5, y: 0.5 };
    const velocity = { x: 0, y: 0 };
    // Cópia mutável: as cores caminham até a paleta do tema em vez de saltar
    const color: Palette = {
      bg: [...paletteRef.current.bg],
      ink: [...paletteRef.current.ink],
      amount: paletteRef.current.amount,
    };
    let time = 0;
    let last = -1;
    let frame = 0;
    let gl: WebGLRenderingContext | null = null;
    let uniforms: Record<string, WebGLUniformLocation | null> = {};

    // Sem WebGL (ou com o contexto perdido) fica um degradê parado em CSS
    const setFallback = (on: boolean) => canvas.classList.toggle("pe-fluid-fallback", on);

    /** Cria (ou recria, após perda de contexto) o programa. false se WebGL não estiver disponível. */
    function init(): boolean {
      gl = canvas!.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
      if (!gl) return false;
      // Mesmo <canvas> remontado (Fast Refresh, StrictMode) devolve o contexto
      // anterior; se ele estiver perdido, pede a restauração e espera o evento
      if (gl.isContextLost()) {
        gl.getExtension("WEBGL_lose_context")?.restoreContext();
        return false;
      }

      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = gl.createProgram();
      if (!vertex || !fragment || !program) return false;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
      gl.useProgram(program);

      // Um triângulo que cobre a tela inteira
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      uniforms = {
        resolution: gl.getUniformLocation(program, "uResolution"),
        time: gl.getUniformLocation(program, "uTime"),
        pointer: gl.getUniformLocation(program, "uPointer"),
        velocity: gl.getUniformLocation(program, "uVelocity"),
        background: gl.getUniformLocation(program, "uBackground"),
        ink: gl.getUniformLocation(program, "uInk"),
        amount: gl.getUniformLocation(program, "uAmount"),
      };
      gl.viewport(0, 0, canvas!.width, canvas!.height);
      return true;
    }

    function resize() {
      const width = Math.max(1, Math.round(window.innerWidth * RESOLUTION_SCALE));
      const height = Math.max(1, Math.round(window.innerHeight * RESOLUTION_SCALE));
      if (canvas!.width === width && canvas!.height === height) return;
      canvas!.width = width;
      canvas!.height = height;
      gl?.viewport(0, 0, width, height);
    }

    function draw() {
      if (!gl || gl.isContextLost()) return;
      gl.uniform2f(uniforms.resolution, canvas!.width, canvas!.height);
      gl.uniform1f(uniforms.time, time);
      gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
      gl.uniform2f(uniforms.velocity, velocity.x, velocity.y);
      gl.uniform3fv(uniforms.background, color.bg);
      gl.uniform3fv(uniforms.ink, color.ink);
      gl.uniform1f(uniforms.amount, color.amount);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function step(now: number) {
      // Primeiro quadro após start(): só marca o relógio. Quadros com o mesmo
      // timestamp (ou anterior) dão dt <= 0, e dx / 0 = NaN envenenava a
      // velocidade para sempre — o fundo quebrava até recarregar a página.
      const elapsed = last < 0 ? 0 : (now - last) / 1000;
      last = now;
      if (elapsed <= 0) {
        draw();
        frame = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(elapsed, 0.05);
      time += dt;

      // O ponto de influência persegue o cursor com atraso; a velocidade dele
      // é o que deforma o fluido, e decai sozinha quando o cursor para
      const follow = 1 - Math.exp(-dt * 5);
      const dx = (target.x - pointer.x) * follow;
      const dy = (target.y - pointer.y) * follow;
      pointer.x += dx;
      pointer.y += dy;
      const ease = 1 - Math.exp(-dt * 3);
      velocity.x += (Math.max(-1, Math.min(1, dx / dt)) - velocity.x) * ease;
      velocity.y += (Math.max(-1, Math.min(1, dy / dt)) - velocity.y) * ease;
      // Rede de segurança: qualquer não-finito aqui travaria o shader de vez
      if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) velocity.x = velocity.y = 0;
      if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
        pointer.x = target.x;
        pointer.y = target.y;
      }

      const goal = paletteRef.current;
      const blend = 1 - Math.exp(-dt * 6);
      for (let i = 0; i < 3; i++) {
        color.bg[i] += (goal.bg[i] - color.bg[i]) * blend;
        color.ink[i] += (goal.ink[i] - color.ink[i]) * blend;
      }
      color.amount += (goal.amount - color.amount) * blend;

      draw();
      frame = requestAnimationFrame(step);
    }

    function drawStill() {
      const goal = paletteRef.current;
      color.bg = [...goal.bg];
      color.ink = [...goal.ink];
      color.amount = goal.amount;
      resize();
      draw();
    }

    function start() {
      cancelAnimationFrame(frame);
      redrawRef.current = null;
      if (!gl || gl.isContextLost()) return;
      if (reducedMotion.matches) {
        // Sem animação: um quadro parado, refeito só quando o tema ou a janela mudam
        redrawRef.current = drawStill;
        drawStill();
      } else if (!document.hidden) {
        // O relógio começa no timestamp do primeiro quadro, não em performance.now(),
        // que pode ser posterior a ele e dar dt negativo
        last = -1;
        frame = requestAnimationFrame(step);
      }
    }

    function onResize() {
      resize();
      if (reducedMotion.matches) draw();
    }

    function onPointerMove(event: PointerEvent) {
      target.x = event.clientX / window.innerWidth;
      target.y = 1 - event.clientY / window.innerHeight;
    }

    // O navegador pode descartar o contexto (GPU reiniciou, aba ficou muito
    // tempo em segundo plano, limite de contextos). Sem isto o fundo sumia
    // e só voltava recarregando a página.
    let recreateTimer = 0;
    function onContextLost(event: Event) {
      event.preventDefault(); // permite o "restored" em seguida
      cancelAnimationFrame(frame);
      setFallback(true);
      // Perdas por excesso de contextos nunca são restauradas: sem o evento
      // em alguns segundos, troca o canvas (com limite para não entrar em laço)
      window.clearTimeout(recreateTimer);
      if (generation < MAX_CANVAS_RECREATIONS) {
        recreateTimer = window.setTimeout(() => setGeneration((g) => g + 1), CONTEXT_RESTORE_TIMEOUT_MS);
      }
    }
    function onContextRestored() {
      window.clearTimeout(recreateTimer);
      if (init()) {
        setFallback(false);
        start();
      }
    }

    resize();
    if (init()) {
      setFallback(false);
      start();
    } else {
      setFallback(true);
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", start);
    reducedMotion.addEventListener("change", start);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(recreateTimer);
      redrawRef.current = null;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", start);
      reducedMotion.removeEventListener("change", start);
      // Não perder o contexto aqui: o mesmo canvas pode ser remontado em seguida
      // e um contexto perdido não volta sozinho. Ao sair do shell o canvas sai do DOM.
    };
  }, [generation]);

  return <canvas key={generation} ref={canvasRef} aria-hidden className="fixed inset-0 -z-10 h-full w-full pointer-events-none" />;
}
