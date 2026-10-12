// Праздничный выстрел конфетти из точки закрытия задачи.
const COLORS = ['#ffbe5c', '#ff8a3d', '#4fc26b', '#3d9df5', '#a46cf0', '#f45b8d', '#ffe066'];

let canvas: HTMLCanvasElement | null = null;
let particles: P[] = [];
let raf = 0;

interface P {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rot: number;
    vr: number;
    w: number;
    h: number;
    color: string;
    life: number;
    shape: 0 | 1;
}

function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.className = 'mv-confetti';
    document.body.appendChild(canvas);
    return canvas;
}

export function burst(x: number, y: number) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const c = ensureCanvas();
    const dpr = window.devicePixelRatio || 1;
    c.width = window.innerWidth * dpr;
    c.height = window.innerHeight * dpr;
    for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
        const s = 6 + Math.random() * 9;
        particles.push({
            x,
            y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s - 2,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.4,
            w: 6 + Math.random() * 6,
            h: 4 + Math.random() * 4,
            color: COLORS[(Math.random() * COLORS.length) | 0],
            life: 1,
            shape: Math.random() < 0.3 ? 1 : 0,
        });
    }
    if (!raf) raf = requestAnimationFrame(tick);
}

function tick() {
    const c = canvas!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
    for (const p of particles) {
        p.vy += 0.35;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.009;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape) {
            ctx.beginPath();
            ctx.arc(0, 0, p.h / 1.4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        }
        ctx.restore();
    }
    if (particles.length) {
        raf = requestAnimationFrame(tick);
    } else {
        raf = 0;
        ctx.clearRect(0, 0, c.width, c.height);
    }
}
