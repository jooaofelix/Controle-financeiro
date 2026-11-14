# Vídeo de apresentação do pagaAI

Vídeo vertical 9:16 (1080×1920, 37 s) feito com HTML animado gravado quadro a quadro.

- `composicao.html` — a animação (cenas, mascote, legendas, transições). Abra no navegador e chame `render(t)` no console para ver qualquer momento.
- `render-video.cjs` — grava os quadros com Playwright e monta o MP4 com ffmpeg.
- `render-quadros.cjs` — tira fotos de momentos específicos (conferência rápida).
- `trilha.py` — trilha sonora original sintetizada (sem direitos de terceiros).
- `saida/pagaai-video.mp4` — vídeo final.

Para gerar de novo:

```bash
node render-video.cjs /tmp/sem-audio.mp4
python3 trilha.py /tmp/trilha.wav
ffmpeg -i /tmp/sem-audio.mp4 -i /tmp/trilha.wav -c:v copy -c:a aac -b:a 192k -shortest saida/pagaai-video.mp4
```
