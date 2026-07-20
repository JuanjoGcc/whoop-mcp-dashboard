# Guía de la estadística del dashboard

Este documento explica **qué significa cada métrica y análisis** del dashboard, **qué valores son buenos o malos**, y **cómo usarlos para decidir cuánta carga meterle a tu cuerpo un día dado**.

Todo se calcula desde tus datos diarios (un valor por métrica por día). No hay datos intradía ni beat-to-beat, así que todo lo de acá está pensado para series diarias.

Índice:
- [Conceptos base](#conceptos-base)
- [1. Baseline EWMA winsorizado](#1-baseline-ewma-winsorizado)
- [2. Z-score robusto (estado por métrica)](#2-z-score-robusto-estado-por-métrica)
- [3. Readiness HRV con banda SWC](#3-readiness-hrv-con-banda-swc)
- [4. ACWR — ratio de carga agudo:crónico](#4-acwr--ratio-de-carga-agudocrónico)
- [5. Correlación strain → recovery](#5-correlación-strain--recovery)
- [Cómo decidir la carga de un día](#cómo-decidir-la-carga-de-un-día)
- [Advertencias](#advertencias)
- [Referencias](#referencias)

---

## Conceptos base

Antes de las métricas, tres ideas que se repiten en todo el documento.

**Baseline (línea base).** Tu "normal" personal para una métrica. No sirve comparar tu HRV con el de otra persona; solo sirve compararlo contra *tu propio* promedio reciente. Casi todo el análisis es "¿hoy estoy sobre o bajo mi baseline?".

**Variabilidad / desviación estándar (SD).** Qué tan dispersos están tus valores alrededor del baseline. La SD define qué es un cambio "real" y qué es simple ruido del día a día. Un valor puede estar más alto que ayer y aun así ser completamente normal si el salto es menor que tu variabilidad típica.

**Ruido vs señal.** Las métricas fisiológicas rebotan mucho día a día. La regla central de todo esto: **no reacciones a un solo día**; reacciona a tendencias sostenidas o a valores que salen claramente de tu banda normal.

---

## 1. Baseline EWMA winsorizado

**Qué es.** La línea base contra la que se comparan HRV, pulso en reposo (RHR) y frecuencia respiratoria. En vez de un promedio simple de 30 días, usa un **promedio móvil exponencial (EWMA)** que le da más peso a los días recientes, con protección contra días extremos.

**Cómo funciona (en palabras):**

1. **EWMA con media vida de 14 noches.** Cada día, el baseline nuevo es una mezcla: `nuevo = λ × valor_de_hoy + (1−λ) × baseline_anterior`. El factor λ viene de una "media vida" de 14 noches — o sea, un valor de hace 14 días pesa la mitad que el de hoy. Esto hace que el baseline **siga tu tendencia** sin quedarse pegado a datos viejos, pero sin saltar por un solo día raro.

2. **Winsorización (recorte).** Antes de meter el valor de hoy al baseline, se recorta a un máximo de ±3 desviaciones del baseline actual. Así una sola noche pésima (dormiste 3 horas, saliste de fiesta) **no envenena** tu línea base.

3. **Rechazo duro.** Si un día se sale más de ±5 desviaciones, se ignora por completo para actualizar el baseline (pero igual se muestra su z-score). Son valores casi seguros de artefacto o evento excepcional.

4. **Spread (dispersión).** En paralelo se lleva un EWMA de la desviación típica (media vida 21 noches), con un piso mínimo por métrica (5 ms para HRV, 2 bpm para RHR). Este spread es lo que define el ancho de las bandas.

**Por qué importa.** Un baseline robusto es la base de todo lo demás. Si tu "normal" está mal calculado, los z-scores y las alertas mienten. Este método es resistente a outliers y reacciona más rápido que una media simple de 30 días.

**Fuente:** implementación basada en el motor de [johnmiddleton12/my-whoop](https://github.com/johnmiddleton12/my-whoop) (`baselines.py`).

---

## 2. Z-score robusto (estado por métrica)

**Qué es.** Un número que dice **a cuántas desviaciones estándar de tu baseline está el valor de hoy**. Es la forma de comparar métricas con unidades distintas (HRV en ms, RHR en bpm) en una misma escala.

**Fórmula:**

```
z = (valor_de_hoy − baseline) / (1.253 × spread)
```

El `1.253` convierte la desviación media absoluta a la desviación estándar equivalente de una distribución normal (es una versión "robusta", menos sensible a outliers que la SD clásica).

**Cómo leerlo (zonas del gráfico):**

| Zona | z-score | Significado |
|------|---------|-------------|
| 🟢 Verde | −1 a +1 | Normal. Estás dentro de tu rango típico. |
| 🟡 Amarillo | ±1 a ±2 | Desviación leve. Vale la pena notarlo, no alarmarse. |
| 🔴 Rojo | más allá de ±2 | Día atípico. Algo cambió (marcado con punto rojo). |

**Importante — el signo depende de la métrica:**

- **HRV:** más alto es mejor. z positivo = bien.
- **RHR (pulso en reposo) y frecuencia respiratoria:** más bajo es mejor. En el dashboard estos van **invertidos**, así que en todos los gráficos **arriba = bueno, abajo = malo** de forma consistente.

**Qué buscar:**

- **HRV con z muy negativo** (bajo tu banda) = sistema nervioso suprimido, fatiga o estrés acumulado.
- **RHR con z negativo** (recuerda: invertido, o sea el pulso *subió*) = tu corazón trabaja más en reposo. Señal clásica de fatiga, deshidratación, alcohol o enfermedad incubándose.
- **Frecuencia respiratoria con z negativo** (respiración *subió*) = uno de los mejores indicadores tempranos de enfermedad respiratoria. Un pico aislado de respiración suele adelantarse a los síntomas.

**La combinación que más importa:** si el **mismo día** ves HRV abajo + RHR arriba + respiración arriba, es la firma clásica de enfermedad o sobrecarga aguda. Ese día se descansa, no se negocia.

---

## 3. Readiness HRV con banda SWC

**Qué es.** El estándar de oro de la literatura para leer HRV. En vez de mirar el HRV crudo (que es ruidosísimo), mira la **media móvil de 7 días** y la compara contra una **banda de cambio significativo (SWC)**.

**Cómo funciona:**

1. **Transformación logarítmica.** El HRV (rMSSD) tiene distribución asimétrica, así que primero se toma `ln(HRV)`. Trabajar en escala logarítmica hace que la estadística sea válida.

2. **Media móvil de 7 días.** Se promedian los últimos 7 días de `ln(HRV)`. Esta línea suavizada es tu "verdadera" tendencia de HRV; los días sueltos son ruido.

3. **Banda SWC (Smallest Worthwhile Change).** Se calcula `media ± 0.5 × SD` del `ln(HRV)` sobre una ventana de 30 días. Esta banda define el rango "normal". **Cambios menores que la banda no significan nada** — son ruido estadístico.

**Cómo leerlo:**

| Posición de la línea | Significado | Qué hacer |
|----------------------|-------------|-----------|
| 🟡 **Dentro** de la banda | Estás en tu rango normal | Entrena según tu plan |
| 🔴 **Bajo** la banda | Fatiga / carga acumulada / estrés | Baja la intensidad, prioriza recuperación |
| 🟢 **Sobre** la banda | Supercompensación (o, ojo, saturación parasimpática) | Buen día para carga alta |

**El matiz de "sobre la banda":** un HRV muy por encima de lo normal casi siempre es buena señal (adaptación, supercompensación). Pero en atletas muy fatigados a veces aparece una *saturación parasimpática* — un HRV artificialmente alto que en realidad es señal de sobreentrenamiento profundo. Por eso el dashboard también vigila si la línea se aplana (ver variabilidad abajo).

**Regla de decisión validada (Vesterinen/Javaloyes):** si tu media de 7 días está **dentro o sobre** la banda → luz verde para entrenar fuerte. Si está **bajo** la banda → día suave. En estudios, entrenar guiado por HRV dio mejores resultados que seguir un plan fijo, porque evita machacar el cuerpo los días en que no está listo.

**Fuentes:** [Plews et al. 2012](https://pubmed.ncbi.nlm.nih.gov/22367011/), [Vesterinen et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26909534/), [Javaloyes et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30160617/).

---

## 4. ACWR — ratio de carga agudo:crónico

**Qué es.** Compara cuánta carga (strain) has metido **últimamente** (agudo, 7 días) contra tu **carga habitual** (crónico, 28 días). Responde: "¿estoy haciendo mucho más de lo que mi cuerpo está acostumbrado?".

**Fórmula:**

```
ACWR = promedio de strain (últimos 7 días) / promedio de strain (últimos 28 días)
```

Necesita ~28 días de historial para ser válido, así que el gráfico se activa recién a partir del día 28.

**Cómo leerlo (zonas de Gabbett):**

| ACWR | Zona | Significado |
|------|------|-------------|
| **< 0.8** | ⬜ Carga baja | Estás entrenando menos que tu norma. Destreinamiento si se sostiene. Ojo: bajar de golpe también te deja desacondicionado y paradójicamente más frágil al volver. |
| **0.8 – 1.3** | 🟢 Zona óptima ("sweet spot") | Tu carga reciente calza con lo que tu cuerpo tolera. Menor riesgo de lesión. Aquí quieres vivir. |
| **1.3 – 1.5** | 🟡 Precaución | Estás subiendo la carga rápido. Se puede, pero con cuidado. |
| **> 1.5** | 🔴 Riesgo alto | Pico de carga peligroso. La evidencia asocia esta zona con **2–4× más riesgo de lesión** en las semanas siguientes. |

**La idea de fondo.** No es la carga *absoluta* la que lesiona, sino los **saltos bruscos** respecto a lo que estás acostumbrado. Un cuerpo bien preparado tolera mucha carga si llegó ahí gradualmente. El ACWR mide justamente esa gradualidad. La regla práctica clásica es no subir la carga semanal más de ~10% de golpe.

**Cómo usarlo con la carga del día:**

- ACWR en 🟢 (0.8–1.3): tienes margen. Un día duro está bien.
- ACWR acercándose a 🟡/🔴 (>1.3): ya vienes cargado. Ese día duro extra es el que lesiona. Mete un día suave o de descanso para que el crónico "alcance" al agudo.
- ACWR en ⬜ (<0.8): puedes subir, pero **gradualmente**. No pases de 0.7 a 1.4 en una semana.

**Fuente y matiz honesto:** [Gabbett 2016](https://pubmed.ncbi.nlm.nih.gov/26758673/). Existe una [crítica metodológica seria (Impellizzeri et al. 2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7485291/) que cuestiona lo estricto de las zonas. Úsalo como **guía de tendencia**, no como ley: la señal valiosa es "¿estoy subiendo la carga más rápido de lo prudente?", no el número exacto.

---

## 5. Correlación strain → recovery

**Qué es.** Mide si tu strain de un día predice tu recovery del día siguiente. Es tu **curva dosis-respuesta personal**: cuánto te "cobra" el cuerpo el esfuerzo.

**Cómo funciona.** Se emparejan el strain del día *t* con el recovery del día *t+1*, sobre todo tu historial, y se calcula el coeficiente de correlación de Pearson (`r`).

**Cómo leer el `r`:**

| r | Significado |
|---|-------------|
| cerca de **−1** | A más strain, peor amaneces al día siguiente. Tu cuerpo acusa fuerte la carga. |
| cerca de **0** | No hay relación clara. Tu recovery depende más de otras cosas (sueño, estrés) que del strain. |
| cerca de **+1** | Raro; implicaría que más strain mejora el recovery (probablemente otra variable de fondo). |

**Banda de ruido.** Con ~143 días, cualquier `r` entre −0.17 y +0.17 es indistinguible de cero. No leas nada en correlaciones dentro de esa banda.

**Cómo usarlo.** Si tu `r` es marcadamente negativo, sabes que los días de mucho strain tienen un costo real y predecible al día siguiente — planifica descanso después de días duros. Si es cerca de cero, tu recovery lo manejan otros factores (típicamente el sueño), y ahí es donde debes enfocar.

**Recordatorio:** correlación no es causalidad. Esto describe patrones, no prueba mecanismos.

---

## Cómo decidir la carga de un día

Junta todo en un pequeño árbol de decisión mental. Míralo en la mañana:

**Paso 1 — ¿Hay banderas rojas de salud?**
Mira los z-scores. Si el mismo día tienes **HRV abajo + RHR arriba + respiración arriba**, para. Es firma de enfermedad o sobrecarga aguda. Descanso, sin importar lo demás.

**Paso 2 — ¿Cómo está tu readiness HRV (banda SWC)?**
- Línea **bajo** la banda → tu sistema nervioso está suprimido. Día suave (zona 2, movilidad, caminata), aunque te sientas con ganas.
- Línea **dentro o sobre** la banda → tienes luz verde fisiológica para cargar.

**Paso 3 — ¿Cuánto margen de carga tienes (ACWR)?**
- ACWR en 🟢 (0.8–1.3) → adelante con el día duro.
- ACWR en 🟡/🔴 (>1.3) → ya vienes acumulando. Aunque el HRV esté bien, considera bajarle para que el crónico alcance al agudo y no dispararte a zona de riesgo.
- ACWR en ⬜ (<0.8) → puedes subir, pero de a poco.

**Paso 4 — ¿Y el sueño?**
El recovery de la mañana mide cómo amaneciste *hoy*, no la deuda que arrastras. Si dormiste poco (mira horas vs. necesitadas y la consistencia), aunque el recovery salga verde, no conviertas el día en algo extremo — el estímulo se paga con sueño que no tuviste. Y prioriza acostarte a tu hora esa noche.

**Resumen en una frase:** el HRV/SWC te dice *si tu cuerpo está listo hoy*; el ACWR te dice *si te has estado pasando en la tendencia*; los z-scores te avisan *si algo anda mal*; y el sueño es el factor que más veces explica por qué el recovery cae. Cruza los cuatro y la decisión de carga sale sola.

---

## Advertencias

- **Nada de esto es consejo médico.** Son herramientas de autoconocimiento deportivo, no diagnóstico.
- **Los primeros ~28 días** son de calibración: los baselines y el ACWR aún no son fiables. Dale tiempo.
- **Un día no es tendencia.** El error más común es reaccionar a un solo dato ruidoso. Todas estas técnicas existen precisamente para separar señal de ruido — respétalo.
- **Estos métodos vienen de estudios en atletas de resistencia.** Las tendencias aplican en general, pero los umbrales exactos son referencias, no verdades universales para tu fisiología particular.

---

## Referencias

- **Baseline HRV / media móvil de ln(rMSSD):** Plews DJ, et al. (2012). *Eur J Appl Physiol.* [PMID 22367011](https://pubmed.ncbi.nlm.nih.gov/22367011/)
- **Cambio significativo (SWC) en HRV:** Vesterinen V, et al. (2016). *Med Sci Sports Exerc.* [PMID 26909534](https://pubmed.ncbi.nlm.nih.gov/26909534/)
- **Entrenamiento guiado por HRV:** Javaloyes A, et al. (2019). *Int J Sports Physiol Perform.* [PMID 30160617](https://pubmed.ncbi.nlm.nih.gov/30160617/)
- **ACWR y riesgo de lesión:** Gabbett TJ (2016). *Br J Sports Med.* [PMID 26758673](https://pubmed.ncbi.nlm.nih.gov/26758673/)
- **Crítica al ACWR:** Impellizzeri FM, et al. (2020). *Front Physiol.* [PMC7485291](https://pmc.ncbi.nlm.nih.gov/articles/PMC7485291/)
- **Monotony / Training Strain:** Foster C (1998). *Med Sci Sports Exerc.* [PMID 9662690](https://pubmed.ncbi.nlm.nih.gov/9662690/)
- **Baselines robustos (implementación de referencia):** [johnmiddleton12/my-whoop](https://github.com/johnmiddleton12/my-whoop)
