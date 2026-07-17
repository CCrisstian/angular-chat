import { Component, OnInit, ChangeDetectorRef, inject, NgZone } from '@angular/core';
import { environment } from '../../environments/environment';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import * as Stomp from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Message } from '../models/message';
import { Usuario } from '../models/usuario';

@Component({
  selector: 'app-chat',
  imports: [FormsModule, DatePipe],
  templateUrl: './chat.html'
})
export class Chat implements OnInit {
  client!: Stomp.Client;
  connected: boolean = false;

  messages: Message[] = [];
  message: Message = new Message();
  writing!: string;

  showModal: boolean = false;
  modalMessage: string = '';

  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  ngOnInit(): void {
    this.client = new Stomp.Client({
      brokerURL: undefined,
      // Variable de entorno para que cambie automáticamente según el entorno
      webSocketFactory: () => new SockJS(`${environment.backendUrl}/chat-websocket`),
      debug: str => console.log(str),
      reconnectDelay: 5000
    });

    // EVENTO 1: CONEXIÓN EXITOSA
    this.client.onConnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = true;
        this.showModal = false; // Nos aseguramos de ocultar el modal si conecta bien

        const usernameTemporal = this.message.usuario.username;
        this.message = new Message();
        this.message.usuario.username = usernameTemporal;

        this.messages = [];
        console.log(`Conectados: ${this.client.connected} : ${frame}`);

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
                });
              });

              this.client.publish({ destination: '/app/history', body: idUsuario.toString() });
            }

            this.messages.push(message);
            this.cdr.detectChanges();
          });
        });

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

    // EVENTO 2: ERROR STOMP (AQUÍ ATRAPAMOS EL RECHAZO DE LOS 4 USUARIOS)
    this.client.onStompError = (frame) => {
      this.ngZone.run(() => {
        console.error('Error STOMP:', frame);
        // Extraemos el texto exacto que enviamos en el MessagingException del backend
        this.modalMessage = frame.headers['message'] || 'Ha ocurrido un error de conexión con el servidor.';
        this.dispararBloqueoPantalla();
      });
    };

    // EVENTO 3: DESCONEXIÓN NORMAL O PERDIDA DE RED
    this.client.onDisconnect = (frame) => {
      this.ngZone.run(() => {
        this.connected = false;
        console.log(`Desconectados: ${!this.client.connected} : ${frame}`);
        this.cdr.detectChanges();
      });
    };
  }

  connect(): void {
    this.client.activate();
  }

  deconnect(): void {
    this.client.deactivate();
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

  // ACCIÓN QUE CONGELA LA PANTALLA Y REINICIA EL ESTADO
  private dispararBloqueoPantalla(): void {
    this.client.deactivate(); // Cortamos el intento de reconexión automática de STOMP
    this.connected = false;
    this.messages = [];
    this.showModal = true; // Encendemos el modal superpuesto
    this.cdr.detectChanges();
  }

  // ACCIÓN DEL BOTÓN EN EL MODAL PARA VOLVER Al INICIO
  resetScreen(): void {
    this.showModal = false;
    this.modalMessage = '';
    // Al cerrar el modal, el usuario verá el header intacto con su nombre para intentar de nuevo
    this.cdr.detectChanges();
  }
}