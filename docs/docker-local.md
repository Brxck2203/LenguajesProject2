# Prueba local con Docker Desktop (Windows)

Ejecutar los comandos en **PowerShell**, desde la raíz del proyecto (la carpeta que contiene `docker-compose.yml`). Docker Desktop debe estar iniciado y utilizar contenedores Linux. No se necesita instalar Go, Java, Scala ni sbt.

## 1. Obtener la versión correcta

Usar la versión final de `main`:

```powershell
git fetch origin
git switch main
git pull --ff-only
```

Si se descargó el proyecto como ZIP, descomprimirlo y abrir PowerShell en la carpeta que contiene `docker-compose.yml`. Git no es necesario para ejecutar esa copia.

## 2. Comprobar Docker y puertos

```powershell
docker info
docker compose version
docker ps
```

Los puertos 5173, 8080, 8081 y 8082 deben estar disponibles. Si siguen corriendo contenedores de otra versión, detener solo los que confirme que pertenecen a este proyecto. Para usar otros puertos, crear `.env` desde `.env.example` y actualizar los `VITE_*_URL` de la consola si se accede desde otro host.

```powershell
docker stop go-analytics-service scala-analytics-service
```

Ese comando solo corresponde si esos nombres aparecen en `docker ps`. Si otro proyecto ocupa los puertos, crear `.env` desde `.env.example` y cambiar `GO_PORT` y `SCALA_PORT`; usar esos puertos al abrir el navegador. El instalador obtiene los puertos efectivos para su prueba automática.

## 3. Construir, probar e iniciar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

El script crea las carpetas de datos, compila y prueba los módulos dentro de las imágenes, espera la salud de los servicios y ejecuta simulaciones por HTTP y archivos. También comprueba la consola, Prolog y el flujo de snapshot parcial. La primera compilación puede tardar varios minutos.

Debe terminar mostrando `OK: consola, Prolog, Go y Scala integrados`. Comprobar:

```powershell
docker compose ps
```

`console`, `prolog-service`, `go-service` y `scala-analytics` deben aparecer `healthy`. Si falla, guardar el error y consultar:

```powershell
docker compose logs --tail=150 console prolog-service go-service scala-analytics
```

No usar `SKIP_TESTS=true` para la primera validación de entrega. En Linux/macOS/WSL, ejecutar `bash scripts/install.sh` en lugar de PowerShell; el instalador también prepara los permisos de escritura de los volúmenes.

## 4. Consultar resultados

Con los puertos predeterminados:

- <http://localhost:5173>: consola para Gato, Memoria y Battleship; panel agregado.
- <http://localhost:8082/health>: salud de Prolog.
- <http://localhost:8081/matches>: partidas recibidas en Go.
- <http://localhost:8081/stats/instances>: conteos de partidas por juego.
- <http://localhost:8080/results>: resultados calculados por Scala.
- <http://localhost:8080/partial>: snapshots de partidas en curso.
- <http://localhost:8080/stats/games>: estadísticas agregadas por juego.
- <http://localhost:8080/stats/games/FREE_FIRE/players>: historial por jugador.
- <http://localhost:8081/inbox>: procesamiento de archivos.

Abre <http://localhost:8081/dashboard> para el panel de revisión de GameStats. La consola de juegos está en <http://localhost:5173>. Las rutas anteriores conservan respuestas JSON para inspección técnica. Los mensajes del simulador indican entrega de eventos; `COMPLETED` y las estadísticas consultadas confirman el análisis.

Para consultar una partida en PowerShell:

```powershell
$partidas = Invoke-RestMethod http://localhost:8081/matches
$id = $partidas.matches[0].matchId
Invoke-RestMethod "http://localhost:8081/matches/$id/analysis" | ConvertTo-Json -Depth 30
```

El resultado debe contener `status: COMPLETED`, estadísticas y un arreglo de patrones. No todas las partidas deben presentar patrones.

## 5. Generar nuevas partidas y probar archivos

```powershell
docker compose run --rm simulator -scenario random -matches 5 -wait
docker compose run --rm simulator -mode files -scenario random -matches 2 -wait
```

`-matches` indica la cantidad **por juego**: los comandos generan 20 y 8 partidas, respectivamente. Los identificadores predeterminados son nuevos en cada ejecución. En modo archivos, revisar `data/inbox/processed`, `data/inbox/rejected` y `data/results`.

Si un archivo se rechaza, consultar su reporte `*.error.json` en `rejected`. Un rechazo no significa que deba reiniciarse todo el proyecto.

## 6. Comprobar persistencia

```powershell
$antes = (Invoke-RestMethod http://localhost:8080/results).count
docker compose restart scala-analytics
```

Esperar a que `docker compose ps` muestre Scala `healthy` y comprobar:

```powershell
$despues = (Invoke-RestMethod http://localhost:8080/results).count
"Antes: $antes; después: $despues"
```

Los resultados de Scala se conservan en `data/results`. El estado de recepción y análisis de **Go es temporal** y se pierde al reiniciar su contenedor. Un resultado guardado sigue consultable en Scala aunque Go ya no tenga esa partida en memoria.

## 7. Detener y volver a iniciar

```powershell
docker compose down
docker compose up -d --wait
```

Los archivos del directorio `data` permanecen en el equipo. No es necesario borrarlos para volver a probar. Usar identificadores nuevos al enviar partidas diferentes.

## 8. Verificar la entrega

- Consola, Prolog, Go y Scala `healthy`.
- Instalador y simulaciones con `-wait` sin errores.
- Resultados de los cuatro juegos en `/stats/games`.
- Partidas de GameConsole visibles en `/stats/instances` y en las métricas parciales/finales de Scala.
- Partidas en `COMPLETED` y valores coherentes con sus eventos.
- Resultados persistidos y recuperados después del reinicio de Scala.
- Workflow CI/CD del PR finalizado correctamente.

La ejecución local mediante Compose es un entorno de despliegue reproducible. La verificación automática del pipeline corre en máquinas temporales de GitHub y no proporciona una dirección pública permanente.

## Panel visual de revisión de GameStats

Abre <http://localhost:8081/dashboard> (o el puerto Go configurado). El panel muestra:

- Resumen por juego y patrones detectados.
- Partidas con estadísticas por jugador, resumen y eventos que sustentan cada patrón.
- Historial acumulado de jugadores.
- Estado de la bandeja y catálogo de eventos.

**Generar demostración** crea ocho partidas nuevas (dos por juego, 73 eventos) y las envía al mismo procesamiento de Go. La recepción es inmediata; el análisis ocurre después en Scala. Esperar unos segundos hasta que aparezcan los resultados. Los errores de Scala se muestran explícitamente y se pueden reintentar los análisis fallidos desde el detalle.

Las partidas con resultados guardados siguen visibles aunque Go se reinicie. El panel no calcula estadísticas: las obtiene de Scala mediante rutas de consulta del mismo servidor Go. Las API JSON originales continúan disponibles, incluida la raíz `/` como índice. Si se usa una URL Scala personalizada, el panel requiere que termine en `/analyze`.
