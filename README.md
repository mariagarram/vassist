# VASSIST

Asistente personal de viajes por WhatsApp, en inglés y árabe, solo por escrito. Prepara propuestas (vuelos, hoteles, restaurantes, traslados); el cliente las aprueba con botones; nada se reserva ni se cobra desde el bot. Tras cada plan pide valoraciones y propone cambios de preferencias que el cliente debe confirmar.

## Qué hay (fase 1)

- **Núcleo** (`src/core`): agente con Claude, herramientas, SQLite, valoraciones, patrones de preferencias, textos EN/AR.
- **WhatsApp** (`src/channels/whatsapp.ts`, `src/server.ts`): webhook con firma verificada, botones y listas, avisos a María.
- **Simulador** (`src/channels/cli.ts`): prueba todo en la terminal, sin Meta.
- **Datos de viajes simulados** (`src/core/providers.ts`). Para datos reales hay que implementar la interfaz `TravelProvider` con un proveedor.

## Probar sin WhatsApp (empieza aquí)

```bash
cp .env.example .env     # rellena ANTHROPIC_API_KEY (solo en este archivo, nunca en el chat)
npm install
npm run cli              # escribes como el cliente; un número pulsa un botón
npm test                 # 54 pruebas con un modelo simulado (no gasta API)
```

## Probar por Telegram (más fácil que WhatsApp)

Sirve para probar el flujo completo (menú, propuestas, `/confirm`, valoraciones, recordatorios) desde el móvil, sin Meta ni dirección pública. **No prueba** la ventana de 24 h ni las plantillas de WhatsApp.

1. En Telegram habla con **@BotFather**, envía `/newbot`, elige nombre y usuario. Copia el token en `TELEGRAM_TOKEN` (`.env`).
2. `npm run telegram` y escribe `hello` a tu bot. La terminal mostrará «Chat no autorizado... añade 123456 a ALLOWED_PHONES».
3. Pon ese número en `ALLOWED_PHONES` y en `OWNER_PHONE` (con una sola cuenta eres cliente y María a la vez; `/confirm` y `/pending` los trata el bot como María). Reinicia y vuelve a escribir.

## Dejarlo encendido siempre (alojamiento)

El bot es un proceso que debe estar en marcha: en tu portátil se para si lo cierras o se duerme. Para producción, súbelo a un servicio con Docker (Railway, Render, Fly.io u otro). Dockerfile incluido (sin probar aquí).

1. Sube el código a un repositorio **privado** de GitHub. `.env` y `data/` no se suben (están en `.gitignore`).
2. Crea el proyecto en el servicio, conectado a ese repositorio.
3. Añade un **volumen persistente** montado en `/app/data`. Sin él, la base de datos (clientes, reservas, preferencias) se borra en cada despliegue.
4. Pon las claves como **variables de entorno** del servicio, no en archivos: `ANTHROPIC_API_KEY`, `TELEGRAM_TOKEN`, `ALLOWED_PHONES`, `OWNER_PHONE`.
5. Solo puede haber **una** copia del bot en marcha con el mismo token: apaga la del portátil antes.
6. Para WhatsApp: variable `VASSIST_MODE=start`, las variables `WHATSAPP_*` y la dirección HTTPS que da el servicio como webhook en Meta.

## Conectar WhatsApp

Los pasos de Meta cambian de pantalla con frecuencia; verifica cada uno en la documentación oficial.

1. Cuenta en Meta for Developers y una app de tipo Business con el producto WhatsApp.
2. En WhatsApp > API Setup: copia el **Phone number ID** (`WHATSAPP_PHONE_ID`) y añade tu número como destinatario de prueba.
3. Token: el temporal caduca en 24 h. Para uno permanente crea un **usuario del sistema** en Business Settings y genéralo con permiso `whatsapp_business_messaging` (`WHATSAPP_TOKEN`).
4. App secret (Settings > Basic) en `WHATSAPP_APP_SECRET`. Sin él el servidor no arranca: así nadie puede enviar mensajes falsos al webhook.
5. Publica el servidor con HTTPS (en local: un túnel como cloudflared o ngrok) y en WhatsApp > Configuration pon `https://TU-DOMINIO/webhook` y tu `WHATSAPP_VERIFY_TOKEN`. Suscríbete al campo `messages`.
6. `ALLOWED_PHONES` con tu número (solo dígitos, con prefijo, sin +). Quien no esté en la lista no recibe respuesta.
7. `OWNER_PHONE` con tu WhatsApp para recibir avisos. Fuera de la ventana de 24 h Meta exige plantilla: crea una de categoría **Utility** con una variable en el cuerpo y ponla en `OWNER_TEMPLATE`.
8. Crea además dos plantillas **Utility** (una en inglés y otra en árabe, una variable en el cuerpo) y ponlas en `REMINDER_TEMPLATE_EN` y `REMINDER_TEMPLATE_AR`. Sin ellas, los recordatorios solo llegan si el cliente ha escrito al bot en las últimas 24 h.
9. `npm start`.

## Planificador de viajes por botones (cualquier destino y medio)

«Plan any trip» en el menú abre un formulario de 13 preguntas que el cliente contesta **pulsando opciones** (solo escribe destino, origen y los «otro»): destino, origen, motivo, cuándo, duración, viajeros, presupuesto, transporte (avión, tren, coche, coche con chófer, bus o ferry, «recomiéndame»), alojamiento, comida, intereses (hasta 3), ritmo y notas. «Saltar el resto» lleva al resumen desde la pregunta 4. Código en `src/core/planner.ts`; las preguntas y opciones están en el array `QS`, con textos EN/AR.

Con el resumen, «Create my plan» entrega el formulario completo a la IA (una sola llamada, sin preguntarlo todo otra vez). La IA redacta la ruta, el plan día a día con restaurantes y actividades, y un coste estimado frente al presupuesto. Después salen los botones **Crear propuestas** (la IA crea vuelo, hotel, transporte, actividad, restaurante con Aprobar/Rechazar) y **Ajustar el plan** (el cliente escribe qué cambiar). Solo vuelos y hoteles tienen buscador (datos de prueba); trenes, rutas en coche y actividades salen del conocimiento del modelo, se marcan como estimaciones y los verifica María antes de confirmar. Escribir texto libre en mitad del formulario lo abandona y lo atiende la IA.

**Hoteles y apartamentos con «Reservar».** Si el cliente no marcó «sin alojamiento», tras el plan aparece **Hoteles y apartamentos**: lista de hasta 6 opciones (destino, fecha y noches del formulario; fecha a 2 semanas si dijo «flexible»), ficha con precio, cancelación y check-in online, y un botón **Reservar**. Reservar crea la propuesta ya aprobada y te avisa con `/confirm ID`: **la reserva real la haces tú con el proveedor** y el cliente recibe la confirmación y los recordatorios al confirmar. Los datos son de prueba hasta conectar un proveedor real; con uno, `searchHotels` puede devolver apartamentos (`type: "apartment"`) y aquí se podría automatizar la reserva y el pago (pendiente).

## El menú (forma principal de uso)

Al escribir por primera vez, o con «menu», «hi», «hello», «مرحبا», «القائمة»..., el cliente ve el menú: **Nuevo viaje · Mis reservas · Mis preferencias · Hablar con María**.

- **Nuevo viaje** es un asistente de pasos con botones y listas, **sin usar la IA**: tipo (vuelo, hotel o viaje completo) → destino → noches → fecha → aeropuerto de salida (solo la primera vez; se guarda) → vuelos → hotel → vuelta. Cada elección crea una propuesta con botones Aprobar / Rechazar.
- Respeta las preferencias guardadas (aerolíneas preferidas o a evitar, solo vuelos directos, estrellas mínimas, check-in online obligatorio) y muestra primero los hoteles con check-in online y llave digital.
- **Texto libre**: cualquier mensaje que no sea un dato que el menú esté esperando lo atiende la IA, y el paso del menú a medias se abandona. La IA puede consultar lo ya elegido en el menú (`list_proposals`).
- **Mis reservas** y **Mis preferencias** son mensajes fijos, sin IA. **Hablar con María** te avisa a ti y avisa al cliente de que le responderás por escrito, sin prometer plazos.
- Límites de WhatsApp: 3 botones por mensaje y 10 filas por lista. Por eso los destinos son 4 más «otro», las fechas son los 5 días siguientes más «otra fecha» y, para lo demás, el cliente escribe.
- Los destinos, vuelos y hoteles son de prueba. Los códigos de ciudad y zonas horarias de ejemplo están en `src/core/providers.ts`; con un proveedor real vendrán de él.
- Hoy el menú solo ofrece vuelos de ida y vuelta con las mismas fechas que el hotel; no hay billetes multi-ciudad ni cambios de reserva por menú (eso se hace escribiendo).

## Cómo funciona un plan

1. El cliente escribe; el bot pregunta lo que falta (máx. 2 preguntas a la vez), busca y ofrece 2-3 opciones.
2. Al elegir, `create_proposal` envía botones **Aprobar / Rechazar**. Al aprobar, María recibe el aviso para confirmar con el proveedor.
3. Cuando el cliente no tiene más peticiones, `complete_plan` cierra el plan y, con todo decidido, se pide la **valoración global** (1-5, obligatoria en el flujo) y, opcionalmente, la de cada elemento.
4. Con 3 o más valoraciones coincidentes (misma aerolínea alta o baja, vuelos directos, hoteles de 4+ estrellas) se propone un cambio de preferencia. **Solo se aplica si el cliente pulsa «Sí».** Si dice que no, no se vuelve a proponer.
5. **Confirmación y recordatorios.** Tras la aprobación del cliente, tú reservas con el proveedor y, en tu WhatsApp, escribes `/confirm ID` (el ID viene en el aviso; `/pending` lista lo que falta). Entonces el cliente recibe «reserva confirmada» y se programan los recordatorios:
   - Vuelo: aviso 24 h antes de la salida con el enlace oficial de check-in, si lo hay (cada aerolínea fija su plazo real). **El bot no hace el check-in.**
   - Hotel: aviso 24 h antes del check-in, con el enlace de check-in online y la llave digital si el hotel los ofrece, y aviso 12 h antes del check-out.
   - Para que existan, la propuesta debe llevar `starts_at`/`ends_at` con zona horaria. Si faltan o ya pasaron, `/confirm` te lo dice.
   - Si WhatsApp rechaza el texto libre (fuera de las 24 h), usa la plantilla `REMINDER_TEMPLATE_EN`/`_AR`. Si también falla 3 veces, te avisa.
6. Cualquier fallo del agente o `report_incident` guarda la incidencia y avisa a María.

## Límites conocidos (por resolver antes de abrirlo a clientes)

- **Ejecución de la reserva**: nada del bot reserva. Falta definir y construir quién ejecuta la reserva tras la aprobación y cómo paga el cliente a cada proveedor.
- **Aviso de respaldo por email**: si WhatsApp falla al avisar a María, la incidencia queda en la base de datos (`notified = 0`) y en el log, pero no hay email ni otro canal todavía.
- **Plantillas**: avisos a María (1) y recordatorios al cliente (1 por idioma). Otros mensajes que el bot envíe primero (p. ej. un vuelo retrasado) necesitarán su propia plantilla aprobada.
- **Check-in de vuelos automático**: no está conectado. Existen servicios de terceros con API (p. ej. 1Checkin, precio por presupuesto) que no he probado; además habría que recoger datos de pasaporte por un canal seguro y revisar RGPD y la ley saudí. Mientras tanto el bot solo recuerda y da el enlace.
- **Check-in de hoteles**: el bot prioriza hoteles con check-in online y llave digital y envía el enlace, pero no puede evitar la cola si el hotel no lo ofrece. Los datos de hoteles y vuelos siguen siendo de prueba (los campos de check-in online y llave digital también).
- **Actividades**: el bot las sugiere con el conocimiento del modelo, sin proveedor ni búsqueda web conectados; pueden estar desactualizadas.
- **Zonas horarias**: los recordatorios dependen de que `starts_at`/`ends_at` lleven zona horaria correcta; con datos de un proveedor real conviene validarlo.
- **Política de Meta sobre bots de IA**: el bot está acotado a viajes a propósito. Es una interpretación de la política, no una confirmación de Meta.
- **Base de datos**: SQLite en un archivo sirve para uno o pocos clientes. Haz copias de seguridad de `data/`. Para más, pasa a Postgres.
- **RGPD / protección de datos de Arabia Saudí (PDPL)**: sin revisar. El bot guarda nombre, teléfono, conversación y preferencias.
- **Divisa**: los importes están en euros; falta decidir si se muestran en SAR.
- **Proveedores reales**: pendientes (Duffel u otro). Las respuestas actuales son datos de prueba.
