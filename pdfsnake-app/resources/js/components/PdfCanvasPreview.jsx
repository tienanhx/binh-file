import React, { useEffect, useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Cấu hình Worker cho PDF.js chạy trực tiếp từ same-origin public folder để tránh lỗi CORS trong chế độ dev
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

// Định nghĩa kích thước các khổ giấy in chuẩn (đơn vị: mm)
export const PAPER_SIZES = {
  A4: { name: 'A4 (210 x 297 mm)', width: 210, height: 297 },
  A3: { name: 'A3 (297 x 420 mm)', width: 297, height: 420 },
  A2: { name: 'A2 (420 x 594 mm)', width: 420, height: 594 },
  Letter: { name: 'Letter (216 x 279 mm)', width: 216, height: 279 },
  Tabloid: { name: 'Tabloid (279 x 432 mm)', width: 279, height: 432 },
  Custom: { name: 'Tùy chỉnh...', width: 300, height: 300 },
};

export default function PdfCanvasPreview({
  pdfFile,
  mode, // 'grid' | 'booklet'
  paperSizeKey,
  customPaperWidth,
  customPaperHeight,
  orientation, // 'portrait' | 'landscape'
  rows,
  cols,
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
  gutterX,
  gutterY,
  cropMarks,
  bookletBinding, // 'left' | 'right'
  bookletCreep, // mm
  currentSheetIndex, // Index của tờ in đang xem (chỉ dùng cho booklet)
  setCurrentSheetIndex,
  onTotalSheetsCalculated,
  onPdfLoaded,
}) {
  const [pages, setPages] = useState([]); // Chứa danh sách data URL các trang PDF gốc
  const [pdfLoading, setPdfLoading] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const canvasRef = useRef(null);

  // 1. Phân tích PDF và chuyển đổi sang dạng ảnh xem trước (canvas -> dataURL)
  useEffect(() => {
    if (!pdfFile) {
      setPages([]);
      return;
    }

    const renderPdf = async () => {
      setPdfLoading(true);
      setPages([]);
      try {
        const fileReader = new FileReader();
        fileReader.onload = async function () {
          try {
            const typedarray = new Uint8Array(this.result);
            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            const pdf = await loadingTask.promise;
            const renderedPages = [];

            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              // Render trang ở scale trung bình để tiết kiệm bộ nhớ & hiển thị nhanh
              const viewport = page.getViewport({ scale: 1.0 });
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;

              await page.render({ canvasContext: context, viewport: viewport }).promise;
              renderedPages.push({
                dataUrl: canvas.toDataURL('image/jpeg', 0.8),
                width: viewport.width,
                height: viewport.height,
                aspectRatio: viewport.width / viewport.height,
              });
            }
            setPages(renderedPages);
            if (onPdfLoaded) {
              onPdfLoaded(renderedPages);
            }
          } catch (err) {
            console.error('Lỗi phân tích nội dung file PDF:', err);
          } finally {
            setPdfLoading(false);
          }
        };
        fileReader.readAsArrayBuffer(pdfFile);
      } catch (err) {
        console.error('Lỗi khi render PDF preview:', err);
      } finally {
        setPdfLoading(false);
      }
    };

    renderPdf();
  }, [pdfFile]);

  // 2. Tính toán kích thước Khổ giấy đích (đơn vị: mm)
  const getPaperDimensions = () => {
    let width = 0;
    let height = 0;

    if (paperSizeKey === 'Custom') {
      width = parseFloat(customPaperWidth) || 300;
      height = parseFloat(customPaperHeight) || 300;
    } else {
      const size = PAPER_SIZES[paperSizeKey] || PAPER_SIZES.A3;
      width = size.width;
      height = size.height;
    }

    // Đổi chiều nếu xoay ngang
    if (orientation === 'landscape') {
      return { width: Math.max(width, height), height: Math.min(width, height) };
    }
    return { width: Math.min(width, height), height: Math.max(width, height) };
  };

  const sheetDim = getPaperDimensions(); // Kích thước thật của tờ in (mm)

  // Giới hạn khung hình hiển thị mặc định (Base Max Width & Height) lớn hơn để dễ nhìn
  const BASE_WIDTH = 750;
  const BASE_HEIGHT = 550;
  const previewAspect = sheetDim.width / sheetDim.height;
  const containerAspect = BASE_WIDTH / BASE_HEIGHT;

  let baseWidth = BASE_WIDTH;
  let baseHeight = BASE_HEIGHT;

  if (previewAspect > containerAspect) {
    // Khổ ngang hơn: fix width, scale height
    baseWidth = BASE_WIDTH;
    baseHeight = Math.round(BASE_WIDTH / previewAspect);
  } else {
    // Khổ đứng hơn: fix height, scale width
    baseHeight = BASE_HEIGHT;
    baseWidth = Math.round(BASE_HEIGHT * previewAspect);
  }

  const canvasWidth = Math.round(baseWidth * zoom);
  const canvasHeight = Math.round(baseHeight * zoom);

  // 3. Tính toán cách sắp xếp trang và số lượng tờ in
  let totalSheets = 1;
  let layoutPages = []; // Danh sách các trang con được vẽ lên tờ hiện tại

  if (pages.length > 0) {
    if (mode === 'grid') {
      const pagesPerSheet = rows * cols;
      
      if (pages.length <= 2) {
        // Tự động lặp lại trang đơn / trang 2 mặt để phủ kín toàn bộ lưới tờ in (thường dùng in namecard)
        totalSheets = pages.length;
        const activePageIdx = currentSheetIndex < pages.length ? currentSheetIndex : 0;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            layoutPages.push({
              pageIndex: activePageIdx,
              row: r,
              col: c,
              rotate: 0,
            });
          }
        }
      } else {
        // Đối với file nhiều trang khác nhau, xếp thứ tự tuần tự
        totalSheets = Math.ceil(pages.length / pagesPerSheet);
        const startIdx = currentSheetIndex * pagesPerSheet;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cellIndex = r * cols + c;
            const pageIndex = startIdx + cellIndex;
            if (pageIndex < pages.length) {
              layoutPages.push({
                pageIndex,
                row: r,
                col: c,
                rotate: 0,
              });
            }
          }
        }
      }
    } else if (mode === 'booklet') {
      // Thiết kế Booklet chuẩn 2-up (2 cột, 1 hàng)
      // Tổng số trang in sách phải là bội số của 4
      const docPages = pages.length;
      const bookletPagesCount = Math.ceil(docPages / 4) * 4;
      totalSheets = bookletPagesCount / 2; // Mỗi sheet có 2 mặt (mặt trước & mặt sau)

      // Một tờ in giấy (Sheet) sẽ gồm Mặt trước (Front) và Mặt sau (Back)
      // Cho nên currentSheetIndex sẽ đại diện cho mặt cụ thể (ví dụ: Sheet 1 Front, Sheet 1 Back)
      // sheetIndex chẵn: Mặt Trước, lẻ: Mặt Sau
      const isBack = currentSheetIndex % 2 !== 0;
      const signatureIndex = Math.floor(currentSheetIndex / 2); // Cặp tờ giấy vật lý tương ứng

      // Thuật toán Saddle Stitch (Đóng ghim giữa)
      // Tìm trang bên trái và trang bên phải
      // Đối với signatureIndex (tính từ ngoài vào trong: 0 là tờ ngoài cùng):
      const leftPageNum = isBack 
        ? (2 * signatureIndex + 2) 
        : (bookletPagesCount - 2 * signatureIndex);
      const rightPageNum = isBack 
        ? (bookletPagesCount - 2 * signatureIndex - 1) 
        : (2 * signatureIndex + 1);

      // Chuyển về 0-indexed index trong mảng pages
      const leftIdx = leftPageNum - 1;
      const rightIdx = rightPageNum - 1;

      // Xếp vào 2 cột (cột 0 là trái, cột 1 là phải)
      if (leftIdx < docPages) {
        layoutPages.push({ pageIndex: leftIdx, row: 0, col: 0, rotate: 0 });
      }
      if (rightIdx < docPages) {
        layoutPages.push({ pageIndex: rightIdx, row: 0, col: 1, rotate: 0 });
      }
    }
  }

  // Gửi thông tin tổng số tờ lên Component cha
  useEffect(() => {
    onTotalSheetsCalculated(totalSheets);
  }, [totalSheets]);

  // 4. Vẽ trực quan lên Canvas HTML5
  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Thiết lập độ phân giải thực tế sắc nét (HiDPI / Retina)
    const ratio = window.devicePixelRatio || 2;
    canvas.width = canvasWidth * ratio;
    canvas.height = canvasHeight * ratio;

    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const cvWidth = canvasWidth;
    const cvHeight = canvasHeight;

    // Tỉ lệ scale đổi từ mm thật -> pixel canvas
    const scale = cvWidth / sheetDim.width;

    // Vẽ nền tờ giấy
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cvWidth, cvHeight);

    // Vẽ bóng và đường viền tờ giấy in
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, cvWidth, cvHeight);

    // Vẽ vùng biên chừa lề (Margins) dạng nét đứt nhẹ
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      marginLeft * scale,
      marginTop * scale,
      (sheetDim.width - marginLeft - marginRight) * scale,
      (sheetDim.height - marginTop - marginBottom) * scale
    );
    ctx.setLineDash([]); // Reset nét đứt

    if (pages.length === 0) {
      // Vẽ chữ thông báo nếu chưa tải file
      ctx.fillStyle = '#64748b';
      ctx.font = '16px Inter, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có file PDF nào được chọn', cvWidth / 2, cvHeight / 2);
      return;
    }

    // Tính toán kích thước lưới ô (Cells)
    const activeCols = mode === 'booklet' ? 2 : cols;
    const activeRows = mode === 'booklet' ? 1 : rows;

    const printableWidth = sheetDim.width - marginLeft - marginRight;
    const printableHeight = sheetDim.height - marginTop - marginBottom;

    // Chiều rộng và chiều cao tối đa của mỗi ô sau khi trừ khoảng cách (Gutter)
    const cellWidth = (printableWidth - (activeCols - 1) * gutterX) / activeCols;
    const cellHeight = (printableHeight - (activeRows - 1) * gutterY) / activeRows;

    // Vẽ các trang lên tờ in
    layoutPages.forEach((item) => {
      const pageInfo = pages[item.pageIndex];
      if (!pageInfo) return;

      // Tọa độ góc trên bên trái của ô (đơn vị: mm)
      const cellLeft = marginLeft + item.col * (cellWidth + gutterX);
      const cellTop = marginTop + item.row * (cellHeight + gutterY);

      // Tự động xoay 90 độ nếu hướng của card ngược với hướng ô lưới để tối ưu diện tích
      const cellAspect = cellWidth / cellHeight;
      const shouldRotate = (pageInfo.aspectRatio > 1 && cellAspect < 1) || (pageInfo.aspectRatio < 1 && cellAspect > 1);
      const effectiveAspectRatio = shouldRotate ? (1 / pageInfo.aspectRatio) : pageInfo.aspectRatio;

      // Tính toán vị trí trang vừa khít trong ô lưới (Scale Fit)
      let drawW = cellWidth;
      let drawH = cellHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (effectiveAspectRatio > cellAspect) {
        // Trang rộng hơn ô: fit theo chiều ngang
        drawH = cellWidth / effectiveAspectRatio;
        offsetY = (cellHeight - drawH) / 2;
      } else {
        // Trang cao hơn ô: fit theo chiều dọc
        drawW = cellHeight * effectiveAspectRatio;
        offsetX = (cellWidth - drawW) / 2;
      }

      // Đổi sang pixel canvas
      const xPx = (cellLeft + offsetX) * scale;
      const yPx = (cellTop + offsetY) * scale;
      const wPx = drawW * scale;
      const hPx = drawH * scale;

      // Vẽ hình ảnh trang PDF
      const img = new Image();
      img.src = pageInfo.dataUrl;
      img.onload = () => {
        if (!active) return;

        if (shouldRotate) {
          ctx.save();
          ctx.translate(xPx + wPx / 2, yPx + hPx / 2);
          ctx.rotate((90 * Math.PI) / 180);
          ctx.drawImage(img, -hPx / 2, -wPx / 2, hPx, wPx);
          ctx.restore();
        } else {
          ctx.drawImage(img, xPx, yPx, wPx, hPx);
        }

        // Vẽ viền mỏng bao quanh từng trang con
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(xPx, yPx, wPx, hPx);

        // Vẽ số trang ở giữa trang con để nhận biết thứ tự dễ dàng
        ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.beginPath();
        ctx.arc(xPx + wPx / 2, yPx + hPx / 2, 14, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.pageIndex + 1, xPx + wPx / 2, yPx + hPx / 2);
      };
      // Gọi vẽ ngay nếu ảnh đã được load trong bộ nhớ cache của trình duyệt
      if (img.complete) {
        img.onload();
      }

      // Vẽ vạch cắt (Crop Marks) nếu được kích hoạt
      if (cropMarks) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        const markLen = 8 * scale; // vạch dài 8mm quy ra pixel

        // Vẽ 4 góc của ô chứa trang con
        // Góc trên bên trái
        ctx.beginPath();
        ctx.moveTo(xPx - 2 * scale, yPx);
        ctx.lineTo(xPx - 2 * scale - markLen, yPx);
        ctx.moveTo(xPx, yPx - 2 * scale);
        ctx.lineTo(xPx, yPx - 2 * scale - markLen);
        ctx.stroke();

        // Góc trên bên phải
        ctx.beginPath();
        ctx.moveTo(xPx + wPx + 2 * scale, yPx);
        ctx.lineTo(xPx + wPx + 2 * scale + markLen, yPx);
        ctx.moveTo(xPx + wPx, yPx - 2 * scale);
        ctx.lineTo(xPx + wPx, yPx - 2 * scale - markLen);
        ctx.stroke();

        // Góc dưới bên trái
        ctx.beginPath();
        ctx.moveTo(xPx - 2 * scale, yPx + hPx);
        ctx.lineTo(xPx - 2 * scale - markLen, yPx + hPx);
        ctx.moveTo(xPx, yPx + hPx + 2 * scale);
        ctx.lineTo(xPx, yPx + hPx + 2 * scale + markLen);
        ctx.stroke();

        // Góc dưới bên phải
        ctx.beginPath();
        ctx.moveTo(xPx + wPx + 2 * scale, yPx + hPx);
        ctx.lineTo(xPx + wPx + 2 * scale + markLen, yPx + hPx);
        ctx.moveTo(xPx + wPx, yPx + hPx + 2 * scale);
        ctx.lineTo(xPx + wPx, yPx + hPx + 2 * scale + markLen);
        ctx.stroke();
      }
    });

    return () => {
      active = false;
    };
  }, [
    pages,
    mode,
    rows,
    cols,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    gutterX,
    gutterY,
    cropMarks,
    sheetDim,
    currentSheetIndex,
    layoutPages,
    canvasWidth,
    canvasHeight
  ]);

  return (
    <div className="flex flex-col items-center w-full relative">
      {pdfLoading && (
        <div className="flex items-center gap-2 text-slate-400 mb-4 animate-pulse">
          <svg className="animate-spin h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm">Đang trích xuất các trang PDF...</span>
        </div>
      )}

      {/* Floating Zoom & Controls Bar */}
      <div className="absolute top-4 z-10 flex items-center gap-2 bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-full px-4 py-1.5 shadow-xl transition-all hover:bg-slate-800">
        <button
          onClick={() => setZoom(Math.max(0.5, zoom - 0.15))}
          title="Thu nhỏ"
          className="text-slate-300 hover:text-white p-1 hover:bg-slate-700/60 rounded-full transition-colors text-xs font-bold w-6 h-6 flex items-center justify-center"
        >
          ➖
        </button>
        <span className="text-xs font-mono font-bold text-slate-200 px-2 min-w-[50px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(Math.min(2.5, zoom + 0.15))}
          title="Phóng to"
          className="text-slate-300 hover:text-white p-1 hover:bg-slate-700/60 rounded-full transition-colors text-xs font-bold w-6 h-6 flex items-center justify-center"
        >
          ➕
        </button>
        <div className="w-px h-4 bg-slate-700 mx-1"></div>
        <button
          onClick={() => setZoom(1.0)}
          title="Kích thước chuẩn"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-bold px-2 py-0.5 hover:bg-slate-700/60 rounded transition-colors"
        >
          100%
        </button>
      </div>

      {/* Khung vẽ Canvas mô phỏng Tờ Giấy In thật */}
      <div className="bg-slate-950 p-8 rounded-2xl border border-slate-800 shadow-2xl flex justify-center items-center w-full overflow-auto max-h-[600px] min-h-[400px] custom-scrollbar">
        <div className="transition-all duration-150 ease-out transform" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
          <canvas
            ref={canvasRef}
            className="shadow-2xl bg-white rounded border border-slate-700"
            style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
          />
        </div>
      </div>

      {/* Điều khiển lật trang/tờ in */}
      {pages.length > 0 && totalSheets > 1 && (
        <div className="flex items-center gap-4 mt-6 bg-slate-800/40 px-5 py-2.5 rounded-xl border border-slate-850">
          <button
            onClick={() => setCurrentSheetIndex(Math.max(0, currentSheetIndex - 1))}
            disabled={currentSheetIndex === 0}
            className="px-3.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            ◀ Trang trước
          </button>
          <span className="text-xs font-bold text-slate-300 text-center min-w-[120px]">
            {mode === 'booklet' ? (
              <>
                Tờ in {Math.floor(currentSheetIndex / 2) + 1} / {totalSheets / 2} 
                <span className="text-[10px] font-normal text-indigo-400 block mt-0.5">
                  ({currentSheetIndex % 2 === 0 ? 'Mặt trước - Front' : 'Mặt sau - Back'})
                </span>
              </>
            ) : (
              <>Tờ in {currentSheetIndex + 1} / {totalSheets}</>
            )}
          </span>
          <button
            onClick={() => setCurrentSheetIndex(Math.min(totalSheets - 1, currentSheetIndex + 1))}
            disabled={currentSheetIndex === totalSheets - 1}
            className="px-3.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Trang sau ▶
          </button>
        </div>
      )}
    </div>
  );
}
