import type { ChangeEvent, JSX } from 'react';
import type { FloorPlan } from '../../../shared/contracts';

interface FloorPlanLibraryProps {
  images: FloorPlan[];
  isUploading: boolean;
  status: string;
  onUpload: (files: File[]) => Promise<void>;
  onRemove: (image: FloorPlan) => void;
}

export function FloorPlanLibrary({ images, isUploading, status, onUpload, onRemove }: FloorPlanLibraryProps): JSX.Element {
  function handleFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files: File[] = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length > 0) void onUpload(files);
  }

  return <section className="floor-plan-library" aria-label="共用平面圖庫">
    <h2>共用平面圖庫 <small>{images.length} 張</small></h2>
    <p>一次上傳所有樓層圖，各測點頁面再選用底圖。</p>
    <label className="secondary-button library-upload">＋ 批次上傳平面圖
      <input aria-label="批次上傳平面圖" type="file" accept="image/png,image/jpeg" multiple disabled={isUploading} onChange={handleFiles} />
    </label>
    {status && <p role="status" className="library-status">{status}</p>}
    <div className="library-images">{images.map((image: FloorPlan) => <figure key={image.id}>
      <img src={image.imageUrl} alt={image.name} /><figcaption title={image.name}>{image.name}</figcaption>
      <button className="library-remove-button" type="button" disabled={isUploading} aria-label={`移除平面圖 ${image.name}`} onClick={() => onRemove(image)}>移除</button>
    </figure>)}</div>
    <p>上傳或移除後請按「儲存設定」，保存圖庫清單。</p>
  </section>;
}
