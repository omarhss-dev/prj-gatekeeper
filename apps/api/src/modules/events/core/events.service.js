import { Inject, Injectable } from '@nestjs/common';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(events) {
    this.events = events;
  }
  create(organizerId, input) {
    return this.events.createWithSections(organizerId, input);
  }
}

Inject(EventsRepository)(EventsService, undefined, 0);
