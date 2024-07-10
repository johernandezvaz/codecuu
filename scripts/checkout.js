document.addEventListener("DOMContentLoaded", async function() {
    try {
      const response = await fetch("https://codec-x7w2.onrender.com/config");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const config = await response.json();
      const stripe = Stripe(config.publicKey);
      const items = [{ id: "Boleto" }];
      let elements;
      let clientSecret;
  
      async function initialize() {
        try {
          const response = await fetch("https://codec-x7w2.onrender.com/create-payment-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          });
  
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
  
          const data = await response.json();
          clientSecret = data.clientSecret;
  
          if (!clientSecret) {
            throw new Error("Failed to retrieve clientSecret from the server.");
          }
  
          const appearance = { theme: 'stripe' };
          elements = stripe.elements({ clientSecret, appearance });
  
          const paymentElementOptions = { layout: "tabs" };
          const paymentElement = elements.create("payment", paymentElementOptions);
  
          paymentElement.mount("#payment-element");
        } catch (error) {
          showModalPopup("Error initializing payment elements.");
        }
      }
  
      async function handleSubmit(e) {
        e.preventDefault();
  
        const nombre = document.getElementById('nombre').value.trim();
        const apellido = document.getElementById('apellido').value.trim();
        const correo = document.getElementById('email').value.trim();
        const telefono = document.getElementById('phone').value.trim();
  
        if (!nombre || !apellido || !correo || !telefono) {
          showModalPopup("Por favor, complete todos los campos antes de continuar.");
          return;
        }
  
        if (!clientSecret || !elements) {
          showModalPopup("Payment elements are not initialized correctly.");
          return;
        }
  
        setLoading(true);
  
        try {
          const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: "https://codec-x7w2.onrender.com/checkout.html",
            },
            redirect: "if_required"
          });
  
          if (error) {
            if (error.type === "card_error" || error.type === "validation_error") {
              showModalPopup(error.message);
            } else {
              showModalPopup("An unexpected error occurred.");
            }
          } else {
            switch (paymentIntent.status) {
              case "succeeded":
                showModalPopup("¡Pago exitoso!\n Verifica tu correo para ver tu boleto y la información relacionada al evento");
                await handleSuccessfulPayment(config);
                break;
              case "processing":
                showModalPopup("Su pago está siendo procesado.");
                break;
              case "requires_payment_method":
                showModalPopup("Su pago no fue exitoso, por favor intente nuevamente.");
                break;
              default:
                showModalPopup("Algo salió mal.");
                break;
            }
          }
        } catch (error) {
          showModalPopup("An error occurred while processing the payment.");
        } finally {
          setLoading(false);
        }
      }
  
      async function checkStatus() {
        const clientSecret = new URLSearchParams(window.location.search).get("payment_intent_client_secret");
  
        if (!clientSecret) {
          return;
        }
  
        try {
          const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
  
          switch (paymentIntent.status) {
            case "succeeded":
              showModalPopup("¡Pago exitoso!");
              break;
            case "processing":
              showModalPopup("Su pago está siendo procesado.");
              break;
            case "requires_payment_method":
              showModalPopup("Su pago no fue exitoso, por favor intente nuevamente.");
              break;
            default:
              showModalPopup("Algo salió mal.");
              break;
          }
        } catch (error) {
          showModalPopup("An error occurred while checking the payment status.");
        }
      }
  
      async function handleSuccessfulPayment(config) {
        emailjs.init(config.emailjsKey); // Sustituye con tu User ID de EmailJS
      
        const nombre = document.getElementById('nombre').value;
        const apellido = document.getElementById('apellido').value;
        const correo = document.getElementById('email').value;
        const telefono = document.getElementById('phone').value;
        const qrData = `Nombre: ${nombre}, Apellido: ${apellido}, Correo: ${correo}, Teléfono: ${telefono}`;
      
        const supabaseUrl = config.supabaseUrl;
        const supabaseKey = config.supabaseKey;
        const sb = supabase.createClient(supabaseUrl, supabaseKey);
      
        const { data, error } = await sb
          .from('participantes')
          .insert([{ nombre, apellido, email: correo, telefono }])
          .select('id')
          .single();
      
        if (error) {
          alert('Error al guardar los datos en la base de datos.');
          return;
        }
      
        const participanteId = data.id;
      
        const { error: ingresoError } = await sb
          .from('ingreso_participantes')
          .insert([{ id_participante: participanteId, ingreso: false }]);
      
        if (ingresoError) {
          alert('Error al guardar los datos en la tabla de ingreso.');
          return;
        }
      
        try {
          const qrCanvas = document.createElement('canvas');
          await QRCode.toCanvas(qrCanvas, qrData, { scale: 3 });
      
          const pdfDoc = await PDFLib.PDFDocument.create();
          const page = pdfDoc.addPage([500, 500]);
      
          const logoUrl = '../assets/logos.png';
          const logoImageBytes = await fetch(logoUrl).then(res => res.arrayBuffer());
          const logoImage = await pdfDoc.embedPng(logoImageBytes);
          const logoDims = logoImage.scale(0.25);
      
          page.drawImage(logoImage, {
            x: 20,
            y: page.getHeight() - logoDims.height - 20,
            width: logoDims.width,
            height: logoDims.height,
          });
      
          page.drawText(`Nombre: ${nombre}`, { x: 20, y: page.getHeight() - logoDims.height - 60, size: 15 });
          page.drawText(`Apellido: ${apellido}`, { x: 20, y: page.getHeight() - logoDims.height - 80, size: 15 });
          page.drawText(`Correo: ${correo}`, { x: 20, y: page.getHeight() - logoDims.height - 100, size: 15 });
          page.drawText(`Teléfono: ${telefono}`, { x: 20, y: page.getHeight() - logoDims.height - 120, size: 15 });
      
          const qrImage = await pdfDoc.embedPng(qrCanvas.toDataURL('image/png'));
          const qrSize = 150;
          page.drawImage(qrImage, {
            x: (page.getWidth() - qrSize) / 2,
            y: 50,
            width: qrSize,
            height: qrSize,
          });
      
          const pdfBytes = await pdfDoc.save();
          const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      
          if (pdfBlob.size > 5000000) {
            alert('El PDF generado es demasiado grande para ser enviado por correo.');
            return;
          }
      
          const reader = new FileReader();
          reader.readAsDataURL(pdfBlob);
          reader.onloadend = function() {
            const base64data = reader.result.split(',')[1];
      
            emailjs.send(config.serviceKey, config.templateKey, {
              to_name: nombre,
              from_name: 'Congreso Dental Chihuahuense (CODEC)',
              to_email: correo,
              message: 'Aquí está tu código QR en formato PDF.',
              file: base64data
            }).then(function(response) {
              showModalPopup('Correo enviado exitosamente!');
            }, function(error) {
              showModalPopup('Error al enviar el correo.');
            });
          };
        } catch (error) {
          showModalPopup('Error al manejar el pago exitoso.');
        }
      }
  
    function showModalPopup(messageText) {
      const modalContent = `
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Mensaje</h5>
              <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div class="modal-body">
              <p>${messageText}</p>
            </div>
          </div>
        </div>
      `;
  
      $('#paymentModal .modal-content').remove();
      $('#paymentModal .modal-dialog').append(modalContent);
      $('#paymentModal').modal('show');
  
      setTimeout(function() {
        $('#paymentModal').modal('hide');
        location.reload();
      }, 3000);
    }
  
    function setLoading(isLoading) {
      const submitButton = document.querySelector("#submit-payment");
      const spinner = document.querySelector("#spinner");
      const buttonText = document.querySelector("#button-text");
  
      if (submitButton && spinner && buttonText) {
        if (isLoading) {
          submitButton.disabled = true;
          spinner.classList.remove("hidden");
          buttonText.classList.add("hidden");
        } else {
          submitButton.disabled = false;
          spinner.classList.add("hidden");
          buttonText.classList.remove("hidden");
        }
      }
    }
  
    $('#submit').on('click', function(event) {
      event.preventDefault();
      $('#paymentModal').modal('show');
    });
  
    document.querySelector("#payment-form").addEventListener("submit", handleSubmit);
  
    $('#paymentModal').on('shown.bs.modal', function () {
      initialize();
      checkStatus();
    });
  } catch (error) {
    showModalPopup("Error fetching configuration. Please check the server and try again.");
  }
  });
  