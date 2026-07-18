import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home';
import { Chat } from './components/chat/chat';
import { DocsComponent } from './components/docs/docs';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'chat', component: Chat },
  { path: 'docs', component: DocsComponent },
  { path: '**', redirectTo: '' } // Si escriben una URL que no existe, los regresa al inicio
];