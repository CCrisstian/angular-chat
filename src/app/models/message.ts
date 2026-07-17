import { Usuario } from './usuario';

export class Message {
    id?: number;
    text: string = '';
    date!: Date;
    type!: string;
    usuario: Usuario = new Usuario();
}