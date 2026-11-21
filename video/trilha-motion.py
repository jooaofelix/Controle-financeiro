# Trilha original do vídeo (sintetizada, sem direitos autorais de terceiros).
# Uso: python3 trilha.py saida.wav
import sys, wave
import numpy as np

SR = 44100
DUR = 17.5
BPM = 128
BEAT = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(42)
mix = np.zeros(N)

def env(n, ataque=0.005, decai=0.2):
    t = np.arange(n) / SR
    a = np.clip(t / ataque, 0, 1)
    return a * np.exp(-t / decai)

def suave(x, k):  # passa-baixa simples (média móvel)
    return np.convolve(x, np.ones(k) / k, mode='same')

def poe(sinal, t0, ganho=1.0):
    i = int(t0 * SR)
    if i >= N: return
    fim = min(N, i + len(sinal))
    mix[i:fim] += sinal[: fim - i] * ganho

def nota(freq, dur, tipo='saw', decai=0.25, harm=8):
    n = int(dur * SR); t = np.arange(n) / SR
    if tipo == 'saw':
        s = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, harm + 1))
    elif tipo == 'pluck':
        s = np.sin(2 * np.pi * freq * t) + .35 * np.sin(2 * np.pi * freq * 2 * t) + .15 * np.sin(2 * np.pi * freq * 3 * t)
    else:
        s = np.sin(2 * np.pi * freq * t)
    return s * env(n, .004, decai)

def kick():
    n = int(.35 * SR); t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .16)

def clap():
    n = int(.25 * SR); r = rng.standard_normal(n)
    r = r - suave(r, 12)
    e = np.exp(-np.arange(n) / SR / .07)
    for d in (0, .012, .024): e += np.roll(np.exp(-np.arange(n) / SR / .01), int(d * SR)) * .6
    return r * e * .5

def hat():
    n = int(.06 * SR); r = rng.standard_normal(n)
    return (r - suave(r, 4)) * np.exp(-np.arange(n) / SR / .015) * .35

def whoosh(dur=.45):
    n = int(dur * SR); r = rng.standard_normal(n); t = np.arange(n) / n
    lo = suave(r, 40); hi = r - suave(r, 6)
    mixr = lo * (1 - t) + hi * t
    return mixr * np.sin(np.pi * t) ** 2 * .9

def pop(f0=500, f1=1400, dur=.12):
    n = int(dur * SR); t = np.arange(n) / SR
    f = np.linspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .05)

HZ = lambda m: 440 * 2 ** ((m - 69) / 12)
# progressão: C – G – Am – F (um acorde por compasso de 4 tempos)
ACORDES = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
BAIXO = [48, 43, 45, 41]
COMPASSO = 4 * BEAT
INICIO_BATIDA = 1.6               # bateria entra quando o logo sai
FIM_MUSICA = 17.0

t = 0.0; c = 0
while t < FIM_MUSICA:
    ac = ACORDES[c % 4]; bx = BAIXO[c % 4]
    for b in range(4):
        tb = t + b * BEAT
        if tb >= FIM_MUSICA: break
        if tb >= INICIO_BATIDA:
            poe(kick(), tb, .95)
            if b in (1, 3): poe(clap(), tb, .55)
            poe(hat(), tb + BEAT / 2, .5)
            poe(hat(), tb + BEAT * .75, .25)
            # baixo em colcheias, oitavando
            poe(nota(HZ(bx), BEAT / 2, 'saw', .12, 5), tb, .22)
            poe(nota(HZ(bx + 12), BEAT / 2, 'saw', .1, 5), tb + BEAT / 2, .16)
        # arpejo em semicolcheias
        for s in range(4):
            m = ac[(b * 4 + s) % 3] + (12 if (b * 4 + s) % 6 >= 3 else 0)
            poe(nota(HZ(m + 12), BEAT / 4, 'pluck', .09), tb + s * BEAT / 4, .13)
    # acorde de fundo suave no início de cada compasso
    for m in ac: poe(nota(HZ(m), COMPASSO, 'saw', 1.2, 4), t, .035)
    t += COMPASSO; c += 1

# efeitos sincronizados com o motion.html
def riser(dur=1.0):
    n = int(dur * SR); r = rng.standard_normal(n); t = np.arange(n) / n
    return (r - suave(r, 3)) * t ** 2 * .5
poe(riser(1.0), 0.0, .5); poe(pop(300, 1600, .3), .95, .6)          # risco de luz e logo
for tt in (1.6, 3.7, 5.85, 8.05, 10.2, 12.3):                         # trocas de tela
    poe(whoosh(.4), tt - .15, .6)
for k in range(14): poe(pop(2400, 2600, .02), 4.05 + k * .057, .18)  # digitando a busca
poe(pop(500, 1300), 5.1, .5)                                         # "pro rolê?"
poe(pop(700, 1800), 7.25, .45)                                       # valor do rolê
for i in range(3): poe(pop(900 + i * 200, 1700 + i * 200, .1), 9.05 + i * .14, .35)   # Pix / Crédito / Débito
poe(pop(600, 1600), 10.65, .5); poe(pop(600, 1600), 11.35, .5)      # notificações
poe(pop(800, 2000), 13.05, .4); poe(pop(900, 2200), 13.6, .45)       # colchão sobe de nível
poe(riser(.8), 14.4, .45); poe(pop(300, 1500, .3), 15.25, .6)        # final
for m in (48, 60, 64, 67, 72): poe(nota(HZ(m), 2.2, 'saw', 1.2, 6), 15.25, .07)

# master: normaliza, satura de leve e faz fade
mix = mix / np.max(np.abs(mix)) * 1.4
mix = np.tanh(mix)
fade = np.ones(N); nf = int(1.2 * SR); fade[-nf:] = np.linspace(1, 0, nf)
fi = int(.03 * SR); fade[:fi] = np.linspace(0, 1, fi)
mix = mix * fade * .85
est = np.stack([mix, np.roll(mix, int(.012 * SR)) * .97], axis=1)  # leve abertura estéreo
pcm = (est * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('trilha ok', sys.argv[1])
