import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TodoShowcaseForm } from '../../../../../components/TodoShowcaseForm'

export default function EditTodoShowcasePage({ params }: { params?: { id?: string } }) {
  return params?.id ? <Page><PageBody><TodoShowcaseForm id={params.id} /></PageBody></Page> : null
}
