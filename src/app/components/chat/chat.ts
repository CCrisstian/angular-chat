import { Component, OnInit, ChangeDetectorRef, inject, NgZone, ViewChild, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import * as Stomp from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Message } from '../../models/message';
import { Usuario } from '../../models/usuario';

@Component({
  selector: 'app-chat',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css']
})
export class Chat implements OnInit {
  // Cliente STOMP: es el motor que gestiona la comunicación sobre el WebSocket .
  client!: Stomp.Client;
  connected: boolean = false;

  messages: Message[] = [];
  message: Message = new Message();

  @ViewChild('chatBody') private chatBody!: ElementRef;

  // Método para hacer scroll solucionando el retraso de renderizado de Angular
  private scrollToBottom(): void {
    try {
      if (this.chatBody) {
        setTimeout(() => {
          this.chatBody.nativeElement.scrollTop = this.chatBody.nativeElement.scrollHeight;
        }, 50); // 50ms dan el tiempo exacto para que Angular termine de dibujar el @for en el DOM
      }
    } catch (err) {
      console.error('Error en scroll:', err);
    }
  }

  writing!: string;

  showModal: boolean = false;
  modalMessage: string = '';

  // cdr (ChangeDetectorRef): fuerza a Angular a actualizar la vista HTML cuando cambian los datos .
  private cdr = inject(ChangeDetectorRef);
  // Envolver el código en ngZone.run() garantiza que Angular detecte los mensajes entrantes en tiempo real .
  private ngZone = inject(NgZone);

  // ===========================================================================
  // INICIALIZACIÓN DEL COMPONENTE Y CONFIGURACIÓN DEL CLIENTE STOMP
  // ===========================================================================

  ngOnInit(): void {
    // 1. Configuración de las reglas de conexión
    this.client = new Stomp.Client({
      brokerURL: undefined, // Se deja indefinido porque usaremos SockJS como capa de transporte en lugar de WS puro .
      // webSocketFactory: crea la conexión HTTP hacia el endpoint configurado en Spring Boot .
      webSocketFactory: () => new SockJS(`${environment.backendUrl}/chat-websocket`),
      debug: str => console.log(str),
      reconnectDelay: 5000 // Si el servidor se cae o está dormido (Cold Start), reintentará conectar cada 5 segundos .
    });

    // 2. EVENTO: CONEXIÓN EXITOSA (onConnect)
    // Se ejecuta automáticamente en el instante en que el handshake STOMP con el servidor termina con éxito .
    this.client.onConnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = true;
        this.showModal = false; // Si estábamos bloqueados por error, liberamos la pantalla .

        // Guardamos el nombre temporal que el usuario escribió en el input para reasignarlo al limpiar el objeto .
        const usernameTemporal = this.message.usuario.username;
        this.message = new Message();
        this.message.usuario.username = usernameTemporal;

        this.messages = [];
        console.log(`Conectados: ${this.client.connected} : ${frame}`);

        // ---------------------------------------------------------------------
        // SUSCRIPCIÓN 1: CANAL DE MENSAJES GENERALES
        // Todos los clientes conectados escuchan este canal para recibir los mensajes del chat y alertas de ingreso .
        // ---------------------------------------------------------------------

        this.client.subscribe('/chat/message', e => {
          this.ngZone.run(() => {
            // Deserializamos el JSON que envía Spring Boot y convertimos la fecha a un objeto Date de JS .
            let message: Message = JSON.parse(e.body) as Message;
            message.date = new Date(message.date);

            // LÓGICA DE REGISTRO E HISTORIAL RELACIONAL:
            // Evaluamos si el mensaje recibido es nuestra propia alerta de ingreso ("NEW_USER") .
            // Si coincide nuestro username y aún no tenemos un ID de base de datos asignado en el front .
            if (this.message.usuario.username == message.usuario?.username && !this.message.usuario.id && message.type == 'NEW_USER') {
              // Atrapamos el objeto usuario que nos devolvió Supabase (que ya contiene nuestro ID numérico y color asignado) .
              this.message.usuario = message.usuario;
              const idUsuario = this.message.usuario.id!;

              // SUSCRIPCIÓN PRIVADA DE HISTORIAL:
              // Nos suscribimos a un canal exclusivo y único para nuestro ID .
              // Nadie más en la sala recibirá los datos que lleguen a esta ruta .
              this.client.subscribe(`/chat/history/${idUsuario}`, histEvent => {
                this.ngZone.run(() => {
                  const histories = (JSON.parse(histEvent.body) as Message[]).map(m => {
                    m.date = new Date(m.date);
                    return m;
                  });
                  // Unimos el historial antiguo con los mensajes nuevos que pudieran haber llegado mientras cargaba .
                  this.messages = [...histories, ...this.messages];
                  this.cdr.detectChanges();
                  this.scrollToBottom(); // <-- SCROLL AUTOMÁTICO AL CARGAR EL HISTORIAL
                });
              });

              // PEDIR HISTORIAL (PUBLISH):
              // Disparamos nuestro ID numérico hacia el método del backend .
              // Spring Boot lo procesará y devolverá la lista por el canal privado al que nos acabamos de suscribir .
              this.client.publish({ destination: '/app/history', body: idUsuario.toString() });

            }

            // Agregamos el mensaje recibido (sea nuestro o de otro usuario) al arreglo para que se renderice en el HTML .
            this.messages.push(message);
            this.cdr.detectChanges();
            this.scrollToBottom(); // <-- SCROLL AUTOMÁTICO AL RECIBIR CUALQUIER MENSAJE NUEVO
          });
        });

        // ---------------------------------------------------------------------
        // SUSCRIPCIÓN 2: CANAL DE ACTIVIDAD DE ESCRITURA
        // Escucha cuando cualquier usuario en la sala presiona una tecla .
        // ---------------------------------------------------------------------

        this.client.subscribe('/chat/writing', e => {
          this.ngZone.run(() => {
            this.writing = e.body;
            this.cdr.detectChanges();

            // Temporizador: borra automáticamente el aviso tras 3 segundos sin recibir nuevos eventos de teclado .
            setTimeout(() => {
              this.writing = '';
              this.cdr.detectChanges();
            }, 3000);
          });
        });

        // ---------------------------------------------------------------------
        // ACCIÓN INICIAL: AVISAR NUESTRO INGRESO AL SERVIDOR
        // Apenas nos conectamos y suscribimos, enviamos el evento NEW_USER al controlador .
        // Esto le indica a Spring Boot que nos registre en Supabase y nos asigne un color .
        // ---------------------------------------------------------------------

        this.message.type = 'NEW_USER';
        this.client.publish({
          destination: '/app/message',
          body: JSON.stringify(this.message)
        });

        this.cdr.detectChanges();
      });
    };

    // 3. EVENTO: ERROR STOMP (onStompError)
    // Se ejecuta cuando Spring Boot rechaza la conexión intencionalmente lanzando una excepción 
    this.client.onStompError = (frame) => {
      this.ngZone.run(() => {
        console.error('Error STOMP:', frame);
        // Extraemos el mensaje de texto enviado desde el backend (o mostramos uno genérico) .
        this.modalMessage = frame.headers['message'] || 'Ha ocurrido un error de conexión con el servidor.';
        this.dispararBloqueoPantalla(); // Congelamos la interfaz .
      });
    };

    // 4. EVENTO: DESCONEXIÓN (onDisconnect)
    // Se dispara cuando cerramos la conexión voluntariamente o si se corta la red .
    this.client.onDisconnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = false;
        console.log(`Desconectados: ${!this.client.connected} : ${frame}`);
        this.cdr.detectChanges();
      });
    };
  }

  // ===========================================================================
  // MÉTODOS DE ACCIÓN DEL USUARIO (CONTROLES DE LA INTERFAZ)
  // ===========================================================================

  // Conectar: se ejecuta al presionar el botón "Conectar" del formulario .
  // Ordena al cliente STOMP que inicie el apretón de manos con Spring Boot .
  connect(): void {
    this.client.activate();
  }

  // Desconectar: se ejecuta al presionar el botón "Desconectar" .
  // Corta la comunicación WebSocket de manera limpia y libera la sesión en el backend .
  deconnect(): void {
    this.client.deactivate();
  }

  // Enviar mensaje: se ejecuta al presionar "Enviar" o presionar Enter en el input de chat .
  onSendmessage(): void {
    this.message.type = 'MESSAGE'; // Marcamos que es un texto conversacional y no una alerta de sistema .
    // Disparamos el objeto convertido a JSON hacia la ruta de recepción en Spring Boot .
    this.client.publish({
      destination: '/app/message',
      body: JSON.stringify(this.message)
    });
    // Limpiamos la caja de texto tras el envío para poder escribir otro mensaje .
    this.message.text = '';
  }

  // Evento escribiendo: se ejecuta en el evento (keyup) del input de texto mientras el usuario teclea .
  onWritingEvent(): void {
    // Envía el nombre del usuario hacia @MessageMapping("/writing") en el backend para notificar a los demás .
    this.client.publish({
      destination: '/app/writing',
      body: this.message.usuario.username
    });
  }

  // ===========================================================================
  // MÉTODOS DE GESTIÓN DEL MODAL Y BLOQUEO DE PANTALLA
  // ===========================================================================

  // Disparar bloqueo: método privado que se activa tras un rechazo del servidor .
  private dispararBloqueoPantalla(): void {
    this.client.deactivate(); // Desactiva el cliente para evitar que STOMP intente reconectarse en un bucle infinito .
    this.connected = false;
    this.messages = []; // Vacía la lista de mensajes en pantalla .
    this.showModal = true; // Muestra el modal superpuesto que impide hacer clic en el chat .
    this.cdr.detectChanges();
  }

  // Reiniciar pantalla: se ejecuta al hacer clic en "Aceptar y Reiniciar" dentro del modal de error .
  resetScreen(): void {
    this.showModal = false; // Oculta el modal .
    this.modalMessage = '';
    // Al limpiar estas banderas, el usuario vuelve a ver el header inicial con su input habilitado para intentar conectar de nuevo .
    this.cdr.detectChanges();
  }

  getMutedColor(hex: string | undefined): string {
    if (!hex) return 'rgba(20, 21, 32, 0.8)'; // Color por defecto si no hay nada
    return hex + '1A'; // '1A' es el valor hexadecimal para ~10% de opacidad
  }
}