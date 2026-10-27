import {z} from 'zod';
export const email=z.string().trim().toLowerCase().email().max(254);
export const password=z.string().min(12).max(128);
export const uuid=z.string().uuid();
export const statuses=['new','in_review','contacted','closed'] as const;
const optionalText=(max:number)=>z.string().trim().max(max).optional();
export const applicationInput=z.object({
  tipo:z.enum(['consulto','servizio','informazioni','noleggio']),
  servizio:z.enum(['fisioterapia','osteopatia','terapie-fisiche','valutazione-oggettiva','non-so']).optional(),
  dove:z.enum(['studio','casa','indifferente']).optional(),
  professionista:z.enum(['giorgio-cardoni','elisa-coppolino','philippe-mancinelli']).optional(),
  dispositivo:optionalText(120),periodo:optionalText(80),
  giorni:z.array(z.enum(['lun','mar','mer','gio','ven','sab'])).max(6).default([]),
  fasce:z.array(z.enum(['mattina','pomeriggio','sera'])).max(3).default([]),
  subito:z.boolean().default(false),
  nome:z.string().trim().min(2).max(80),
  telefono:z.string().trim().min(6).max(24).regex(/^[+()\d\s./-]+$/).refine(v=>v.replace(/\D/g,'').length>=6),
  email:email.optional(),contatto:z.enum(['telefono','whatsapp','email']),
  perAltraPersona:z.string().trim().min(2).max(80).optional(),note:optionalText(500),
  privacy:z.literal(true),sito:optionalText(200),
}).strict().refine(v=>v.contatto!=='email'||!!v.email,{message:'Email richiesta',path:['email']});
export const listQuery=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),status:z.enum(statuses).optional(),assignment:z.enum(['all','unassigned']).default('all')}).strict();
