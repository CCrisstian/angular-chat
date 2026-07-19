import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, NgZone, ViewChild, ElementRef, HostListener } from '@angular/core';
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
export class Chat implements OnInit, OnDestroy {
  client!: Stomp.Client;
  connected: boolean = false;
  
  // Contador de usuarios activos en el chat
  activeUsersCount: number = 0;
  
  // Temporizador para consultar estadísticas HTTP mientras se está desconectado
  private statsPollingInterval: any;

  messages: Message[] = [];
  message: Message = new Message();

  @ViewChild('chatBody') private chatBody!: ElementRef;

  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  // ===========================================================================
  // EVENTOS DE DESCONEXIÓN INMEDIATA
  // ===========================================================================

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    this.deconnect();
  }

  ngOnDestroy(): void {
    this.deconnect();
    clearInterval(this.statsPollingInterval);
  }

  // ===========================================================================
  // CONSULTA HTTP PREVIA A LA CONEXIÓN (POLLING DE ESTADÍSTICAS)
  // ===========================================================================

  private startStatsPolling(): void {
    // Evita duplicar temporizadores si ya existe uno activo
    clearInterval(this.statsPollingInterval);
    
    // Hace una consulta inmediata apenas carga la pantalla
    this.fetchInitialStats();

    // Reconsulta cada 3 segundos mientras no esté dentro de la sala WebSocket
    this.statsPollingInterval = setInterval(() => {
      if (!this.connected) {
        this.fetchInitialStats();
      }
    }, 3000);
  }

  private async fetchInitialStats(): Promise<void> {
    try {
      const response = await fetch(`${environment.backendUrl}/api/chat/stats`);
      if (response.ok) {
        const data = await response.json();
        // Solo actualizamos la vista por HTTP si no estamos conectados vía STOMP
        if (!this.connected) {
          this.activeUsersCount = data.activeUsers;
          this.cdr.detectChanges();
        }
      }
    } catch (err) {
      // Falla en silencio (por ejemplo, si el backend en Render está en Cold Start)
    }
  }

  // ===========================================================================
  // MÉTODOS DE SCROLL
  // ===========================================================================

  private scrollToBottom(): void {
    try {
      if (this.chatBody) {
        setTimeout(() => {
          this.chatBody.nativeElement.scrollTop = this.chatBody.nativeElement.scrollHeight;
        }, 50);
      }
    } catch (err) {
      console.error('Error en scroll:', err);
    }
  }

  writing!: string;
  showModal: boolean = false;
  modalMessage: string = '';

  // ===========================================================================
  // INICIALIZACIÓN Y SUSCRIPCIONES STOMP
  // ===========================================================================

  ngOnInit(): void {
    // INICIO: Empezamos a monitorear la sala por HTTP apenas el usuario abre la página
    this.startStatsPolling();

    this.client = new Stomp.Client({
      brokerURL: undefined,
      webSocketFactory: () => new SockJS(`${environment.backendUrl}/chat-websocket`),
      debug: str => console.log(str),
      reconnectDelay: 5000
    });

    this.client.onConnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = true;
        this.showModal = false;

        // Al conectar con el WebSocket, apagar el sondeo HTTP para ahorrar recursos
        clearInterval(this.statsPollingInterval);

        const usernameTemporal = this.message.usuario.username;
        this.message = new Message();
        this.message.usuario.username = usernameTemporal;
        this.messages = [];

        // --- SUSCRIPCIÓN 0: ESTADÍSTICAS Y CONTEO EN TIEMPO REAL VÍA WS ---
        this.client.subscribe('/chat/stats', e => {
          this.ngZone.run(() => {
            this.activeUsersCount = Number(e.body);
            this.cdr.detectChanges();
          });
        });

        // --- SUSCRIPCIÓN 1: MENSAJES GENERALES ---
        this.client.subscribe('/chat/message', e => {
          this.ngZone.run(() => {
            let message: Message = JSON.parse(e.body) as Message;
            message.date = new Date(message.date);

            if (this.message.usuario.username == message.usuario?.username && !this.message.usuario.id && message.type == 'NEW_USER') {
              this.message.usuario = message.usuario;
              const idUsuario = this.message.usuario.id!;

              this.client.subscribe(`/chat/history/${idUsuario}`, histEvent => {
                this.ngZone.run(() => {
                  const histories = (JSON.parse(histEvent.body) as Message[]).map(m => {
                    m.date = new Date(m.date);
                    return m;
                  });
                  this.messages = [...histories, ...this.messages];
                  this.cdr.detectChanges();
                  this.scrollToBottom();
                });
              });

              this.client.publish({ destination: '/app/history', body: idUsuario.toString() });
            }

            this.messages.push(message);
            this.cdr.detectChanges();
            this.scrollToBottom();
          });
        });

        // --- SUSCRIPCIÓN 2: ESCRITURA EN TIEMPO REAL ---
        this.client.subscribe('/chat/writing', e => {
          this.ngZone.run(() => {
            this.writing = e.body;
            this.cdr.detectChanges();
            setTimeout(() => {
              this.writing = '';
              this.cdr.detectChanges();
            }, 3000);
          });
        });

        this.message.type = 'NEW_USER';
        this.client.publish({
          destination: '/app/message',
          body: JSON.stringify(this.message)
        });

        this.cdr.detectChanges();
      });
    };

    this.client.onStompError = (frame) => {
      this.ngZone.run(() => {
        this.modalMessage = frame.headers['message'] || 'Ha ocurrido un error de conexión con el servidor.';
        this.dispararBloqueoPantalla();
      });
    };

    this.client.onDisconnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = false;
        // Al perder conexión WS, reactivar el monitoreo por HTTP
        this.startStatsPolling();
        this.cdr.detectChanges();
      });
    };
  }

  // ===========================================================================
  // CONTROLES DE LA INTERFAZ Y MODAL
  // ===========================================================================

  connect(): void {
    this.client.activate();
  }

  deconnect(): void {
    if (this.client && this.client.active) {
      this.client.deactivate();
      this.connected = false;
      // Al desconectarse voluntariamente, reactivar monitoreo HTTP para ver los usuarios que quedan
      this.startStatsPolling();
      this.cdr.detectChanges();
    }
  }

  onSendmessage(): void {
    this.message.type = 'MESSAGE';
    this.client.publish({
      destination: '/app/message',
      body: JSON.stringify(this.message)
    });
    this.message.text = '';
  }

  onWritingEvent(): void {
    this.client.publish({
      destination: '/app/writing',
      body: this.message.usuario.username
    });
  }

  private dispararBloqueoPantalla(): void {
    this.client.deactivate();
    this.connected = false;
    this.messages = [];
    this.showModal = true;
    // En caso de bloqueo (por ejemplo, sala llena 4/4), consultar por HTTP el estado en tiempo real
    this.startStatsPolling();
    this.cdr.detectChanges();
  }

  resetScreen(): void {
    this.showModal = false;
    this.modalMessage = '';
    this.cdr.detectChanges();
  }

  getMutedColor(hex: string | undefined): string {
    if (!hex) return 'rgba(20, 21, 32, 0.8)';
    return hex + '1A';
  }
}