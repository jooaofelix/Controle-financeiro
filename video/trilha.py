# Trilha original do vídeo (sintetizada, sem direitos autorais de terceiros).
# Uso: python3 trilha.py saida.wav
import sys, wave
import numpy as np

SR = 44100
DUR = 37.0
BPM = 120
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
INICIO_BATIDA = 2 * BEAT       # bateria entra no 3º tempo
FIM_MUSICA = 36.0

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

# efeitos sincronizados com o vídeo
for tt in (3.2, 7.0, 13.4, 17.4, 21.4, 26.4, 30.4, 33.4):
    poe(whoosh(), tt - .2, .55)
poe(pop(400, 1500), .35, .5)                  # logo aparece
poe(pop(900, 1900, .09), 8.32, .35); poe(pop(1900, 1900, .09), 8.47, .35)  # bip da maquininha
poe(pop(600, 1600), 9.95, .5)                 # notificação desce
poe(pop(500, 1300), 22.45, .35)               # fatura aparece
poe(pop(700, 1700), 24.45, .45)               # saldo fica verde
poe(pop(400, 1500), 33.65, .55)               # logo final
# acorde final sustentado
for m in (48, 60, 64, 67, 72): poe(nota(HZ(m), 3.4, 'saw', 1.4, 6), 33.4, .07)

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
